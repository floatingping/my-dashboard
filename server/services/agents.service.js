import { closeSync, existsSync, mkdirSync, openSync, readSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Cron } from "croner";
import { assertBoardAccess } from "../lib/access.js";
import { emit } from "../lib/bus.js";
import { config } from "../lib/config.js";
import { newToken, sha256 } from "../lib/crypto.js";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors.js";
import { killTree, spawnNode } from "../lib/proc.js";
import { byId, clampInt, text, toStringList, uniq } from "../lib/util.js";
import { ensureAgentUser } from "../handlers/agent-user.handler.js";
import { getBoardContext } from "../handlers/board-context.handler.js";
import { getChatHistory } from "../handlers/chat-history.handler.js";
import { addComment } from "../handlers/comment-create.handler.js";
import { getBoardSummary, getPmDigest } from "../handlers/pm-digest.handler.js";
import { getTicketDetail } from "../handlers/ticket-detail.handler.js";
import { changeTicketStatus } from "../handlers/ticket-status.handler.js";
import { chatFirstMessage, chatSystemPrompt, pmSystemPrompt, pmTickMessage } from "../prompts/pm.js";
import { workerFirstMessage, workerSystemPrompt } from "../prompts/worker.js";
import * as boardsRepo from "../repos/boards.repo.js";
import * as chatRepo from "../repos/chat.repo.js";
import * as runsRepo from "../repos/runs.repo.js";
import * as skillsRepo from "../repos/skills.repo.js";
import * as ticketsRepo from "../repos/tickets.repo.js";
import * as usersRepo from "../repos/users.repo.js";

const jobs = new Map(); // boardId → Cron
const live = new Map(); // runId → { child, run, killedBy }
const starting = new Set(); // "pm-1"、"chat-1"：啟動中，避免同時開兩個
const chatQueued = new Set(); // PM 回覆中又有人發問的看板
const pmFailures = new Map(); // boardId → { count, at }

const PM_FAIL_PAUSE_MS = 15 * 60 * 1000;
const LOG_CHUNK = 256 * 1024;
const ACTIVE_STATUSES = ["todo", "doing", "pending"];

function logError(err) {
  console.error("[agents]", err);
}

function logPath(runId) {
  return path.join(config.logDir, `run-${runId}.log`);
}

function liveRuns(boardId) {
  return [...live.values()].map((entry) => entry.run).filter((run) => run.board_id === boardId);
}

function isBusy(boardId, kind) {
  return starting.has(`${kind}-${boardId}`) || liveRuns(boardId).some((run) => run.kind === kind);
}

async function withAgentNames(runs) {
  const users = byId(await usersRepo.getByIds(uniq(runs.map((r) => r.agent_user_id))));
  return runs.map((r) => ({ ...r, agent_name: users.get(r.agent_user_id)?.name ?? "?", live: live.has(r.id) }));
}

// 執行中 agent 的狀況：跑了多久、多久沒有新輸出、最後一行 log（給 PM 判斷有沒有卡住）
function runActivity(run) {
  const file = logPath(run.id);
  const now = Date.now();
  const activity = { elapsed_min: Math.round((now - new Date(run.started_at).getTime()) / 60000), idle_min: 0, last_log: "" };
  if (!existsSync(file)) return activity;
  const stat = statSync(file);
  activity.idle_min = Math.round((now - stat.mtimeMs) / 60000);
  const length = Math.min(stat.size, 4096);
  const buffer = Buffer.alloc(length);
  const fd = openSync(file, "r");
  try {
    readSync(fd, buffer, 0, length, stat.size - length);
  } finally {
    closeSync(fd);
  }
  const lines = buffer.toString("utf8").split("\n").filter((line) => line.trim());
  activity.last_log = (lines.at(-1) ?? "").slice(0, 200);
  return activity;
}

// ---------- 排程 ----------

export async function init() {
  const orphans = await runsRepo.markOrphans();
  if (orphans.length) console.log(`[agents] ${orphans.length} 個上次沒結束的執行已標記為失敗`);
  for (const board of await boardsRepo.list()) syncBoard(board);
}

export function syncBoard(board) {
  jobs.get(board.id)?.stop();
  jobs.delete(board.id);
  if (!board.enabled) return;
  try {
    jobs.set(board.id, new Cron(board.cron, { protect: true }, () => tick(board.id).catch(logError)));
  } catch (err) {
    console.error(`[agents] 看板 #${board.id} 的 cron 無效：${err.message}`);
  }
}

export async function removeBoard(boardId) {
  jobs.get(boardId)?.stop();
  jobs.delete(boardId);
  for (const entry of live.values()) {
    if (entry.run.board_id !== boardId) continue;
    entry.killedBy = "刪除看板";
    await killTree(entry.child.pid);
  }
}

export function scheduleInfo(boardId) {
  const runs = liveRuns(boardId);
  return {
    next_check_at: jobs.get(boardId)?.nextRun() ?? null,
    pm_running: runs.some((r) => r.kind === "pm"),
    chat_running: runs.some((r) => r.kind === "chat"),
    workers_running: runs.filter((r) => r.kind === "worker").length
  };
}

// PM 照排程檢查：時間到就檢查；看板完全沒事（沒有進行中的票、沒有 agent 在跑、也沒有新動態）才跳過
export async function tick(boardId, { force = false } = {}) {
  const board = await boardsRepo.getById(boardId);
  if (!board) return { started: false, reason: "找不到看板" };
  if (!force && !board.enabled) return { started: false, reason: "看板已停用" };
  if (isBusy(boardId, "pm")) return { started: false, reason: "PM 正在檢查中" };
  if (!force) {
    const fail = pmFailures.get(boardId);
    if (fail && fail.count >= 3 && Date.now() - fail.at < PM_FAIL_PAUSE_MS) {
      return { started: false, reason: "PM 連續失敗，暫停 15 分鐘" };
    }
    const counts = await ticketsRepo.countByStatus(boardId);
    const activeTickets = counts.filter((c) => ACTIVE_STATUSES.includes(c.status)).reduce((sum, c) => sum + c.count, 0);
    const hasNews =
      board.last_activity_at && (!board.last_pm_check_at || board.last_activity_at > board.last_pm_check_at);
    if (!activeTickets && !liveRuns(boardId).length && !hasNews) {
      return { started: false, reason: "看板沒有進行中的票" };
    }
  }

  starting.add(`pm-${boardId}`);
  try {
    const ctx = await getBoardContext(boardId);
    const digest = await getPmDigest(boardId, board.last_pm_check_at);
    digest.running = digest.running.map((run) => ({ ...run, ...runActivity(run) }));
    const run = await launch({
      board,
      kind: "pm",
      agentUserId: board.pm_user_id,
      agentName: ctx.pmName,
      model: board.pm_model || config.defaultModel,
      system: pmSystemPrompt(ctx),
      first: pmTickMessage({ digest, pmUserId: board.pm_user_id }),
      maxTurns: Math.min(board.max_turns, 30),
      skills: board.pm_skills
    });
    return { started: true, run };
  } finally {
    starting.delete(`pm-${boardId}`);
  }
}

// ---------- PM 派工作 agent ----------

export async function dispatchWorker(actor, boardId, input) {
  if (actor.type !== "agent" || actor.role !== "pm" || actor.boardId !== boardId) {
    throw forbidden("只有這個看板的 PM 可以派 agent");
  }
  const board = await boardsRepo.getById(boardId);
  if (!board) throw notFound("找不到看板");
  const ticket = await ticketsRepo.getById(Number(input.ticket_id));
  if (!ticket || ticket.board_id !== boardId) throw notFound("找不到票");
  if (ticket.status === "close") throw badRequest("票已經 close，不能再派 agent");

  const agentName = text(input.agent_name, { label: "agent_name", max: 40, required: true });
  const prompt = text(input.prompt, { label: "prompt", max: 20000, required: true });
  const skills = toStringList(input.skills);
  const notAllowed = skills.filter((s) => !board.allowed_skills.includes(s));
  if (notAllowed.length) throw badRequest(`這些 skill 不在可下放清單：${notAllowed.join(", ")}`);

  const workers = liveRuns(boardId).filter((r) => r.kind === "worker");
  if (workers.some((r) => r.ticket_id === ticket.id)) throw conflict(`票 #${ticket.id} 已經有 agent 在做`);
  if (workers.length >= board.max_workers) {
    throw conflict(`同時最多 ${board.max_workers} 個工作 agent，目前已滿，請等下次檢查再派`);
  }
  const tries = await runsRepo.countByTicket(ticket.id, "worker");
  if (tries >= config.maxDispatchPerTicket) {
    throw conflict(`票 #${ticket.id} 已經派過 ${tries} 次，請改成 pending 並請人協助`);
  }

  const agent = await ensureAgentUser(agentName);
  if (ticket.status !== "doing") await changeTicketStatus({ ticket, status: "doing", user_id: actor.user.id });
  const skillRows = await skillsRepo.getByNames(skills);
  const detail = await getTicketDetail(ticket.id);
  const run = await launch({
    board,
    kind: "worker",
    ticketId: ticket.id,
    agentUserId: agent.id,
    agentName: agent.name,
    model: board.worker_model || config.defaultModel,
    system: workerSystemPrompt({ board, agentName: agent.name, prompt, skills: skillRows }),
    first: workerFirstMessage({ ticket: detail }),
    maxTurns: board.max_turns,
    prompt,
    skills
  });
  emit("ticket", { boardId, ticketId: ticket.id });
  return { ...run, agent_name: agent.name };
}

// ---------- 問 PM ----------

export async function startChat(boardId) {
  if (isBusy(boardId, "chat")) {
    chatQueued.add(boardId);
    return null;
  }
  const board = await boardsRepo.getById(boardId);
  if (!board) return null;
  starting.add(`chat-${boardId}`);
  try {
    const ctx = await getBoardContext(boardId);
    const summary = await getBoardSummary(boardId);
    const history = await getChatHistory(boardId, 30);
    summary.running = summary.running.map((run) => ({ ...run, ...runActivity(run) }));
    return await launch({
      board,
      kind: "chat",
      agentUserId: board.pm_user_id,
      agentName: ctx.pmName,
      model: board.pm_model || config.defaultModel,
      system: chatSystemPrompt(ctx),
      first: chatFirstMessage({ summary, history, pmUserId: board.pm_user_id }),
      maxTurns: 20,
      skills: board.pm_skills
    });
  } finally {
    starting.delete(`chat-${boardId}`);
  }
}

// ---------- 子行程 ----------

async function launch({ board, kind, ticketId = null, agentUserId, agentName, model, system, first, maxTurns, prompt = "", skills = [] }) {
  mkdirSync(board.folder, { recursive: true });
  const token = newToken();
  const run = await runsRepo.create({
    board_id: board.id,
    ticket_id: ticketId,
    kind,
    agent_user_id: agentUserId,
    model,
    prompt,
    skills,
    token_hash: sha256(token)
  });

  const configFile = path.join(config.runDir, `run-${run.id}.json`);
  writeFileSync(
    configFile,
    JSON.stringify(
      { runId: run.id, kind, boardId: board.id, ticketId, agentName, model, maxTurns, system, first, cwd: board.folder },
      null,
      2
    )
  );
  const env = {
    ...process.env,
    ANTHROPIC_API_KEY: config.anthropic.apiKey,
    ANTHROPIC_VERSION: config.anthropic.version,
    ANTHROPIC_BASE_URL: config.anthropic.baseUrl,
    KANBAN_API: `http://127.0.0.1:${config.port}/api`,
    KANBAN_TOKEN: token,
    GIT_PATH: config.gitPath
  };
  const child = spawnNode(config.runnerScript, [configFile], { env, cwd: board.folder, logFile: logPath(run.id) });
  live.set(run.id, { child, run, killedBy: null });
  child.once("exit", (code) => onExit(run.id, code).catch(logError));
  child.once("error", () => onExit(run.id, -1).catch(logError));

  const updated = await runsRepo.update(run.id, { pid: child.pid ?? null });
  emit("run", { boardId: board.id, runId: run.id, ticketId });
  return updated ?? run;
}

async function onExit(runId, code) {
  const entry = live.get(runId);
  if (!entry) return;
  live.delete(runId);
  const { run, killedBy } = entry;
  const status = killedBy ? "killed" : code === 0 ? "succeeded" : "failed";
  await runsRepo.update(runId, {
    status,
    exit_code: code ?? null,
    ended_at: new Date(),
    token_hash: null,
    error: killedBy ? `由 ${killedBy} 關閉` : null
  });

  if (run.kind === "pm") {
    if (status === "succeeded") {
      // 下次檢查只看這次開始之後的動態
      await boardsRepo.setPmCheck(run.board_id, run.started_at);
      pmFailures.delete(run.board_id);
    } else if (status === "failed") {
      const prev = pmFailures.get(run.board_id);
      pmFailures.set(run.board_id, { count: (prev?.count ?? 0) + 1, at: Date.now() });
    }
  } else if (run.kind === "worker") {
    // 工作 agent 結束後等 PM 下次排程檢查時驗收
    if (status === "succeeded") {
      await boardsRepo.touchActivity(run.board_id);
    } else if (run.ticket_id) {
      const note = killedBy
        ? `⛔ agent 已被 ${killedBy} 關閉。`
        : `⚠️ agent 異常結束（exit code ${code}），詳見執行紀錄 #${runId}。`;
      await addComment({
        ticket_id: run.ticket_id,
        board_id: run.board_id,
        user_id: run.agent_user_id,
        content: note,
        countActivity: true
      });
    }
  } else if (run.kind === "chat") {
    if (status !== "succeeded") {
      await chatRepo.create({
        board_id: run.board_id,
        user_id: run.agent_user_id,
        content: killedBy ? "（這次回覆已被關閉）" : `⚠️ 回覆失敗，詳見執行紀錄 #${runId}`
      });
    }
    emit("chat", { boardId: run.board_id });
    if (chatQueued.delete(run.board_id)) startChat(run.board_id).catch(logError);
  }

  emit("run", { boardId: run.board_id, runId, ticketId: run.ticket_id });
  if (run.ticket_id) emit("ticket", { boardId: run.board_id, ticketId: run.ticket_id });
}

// ---------- 關閉、查詢 ----------

// 人可以關任何執行；PM 只能關自己看板的工作 agent
export async function kill(runId, actor) {
  const run = await runsRepo.getById(runId);
  if (!run) throw notFound("找不到執行紀錄");
  if (actor.type === "agent" && (actor.role !== "pm" || actor.boardId !== run.board_id || run.kind !== "worker")) {
    throw forbidden("PM 只能關掉自己看板的工作 agent");
  }
  const entry = live.get(runId);
  if (!entry) {
    if (run.status === "running") {
      await runsRepo.update(runId, { status: "killed", ended_at: new Date(), token_hash: null });
    }
    return { ok: true, message: "這個執行已經結束了" };
  }
  entry.killedBy = actor.user.name;
  await killTree(entry.child.pid);
  return { ok: true, message: "已關閉" };
}

export async function listRuns(boardId, actor, query = {}) {
  assertBoardAccess(actor, boardId);
  if (actor.role === "worker") throw forbidden("工作 agent 不能查看執行紀錄");
  const runs = await runsRepo.listByBoard(boardId, { limit: clampInt(query.limit, 1, 200, 50) });
  return withAgentNames(runs);
}

export async function getRun(runId, actor) {
  const run = await runsRepo.getById(runId);
  if (!run) throw notFound("找不到執行紀錄");
  assertBoardAccess(actor, run.board_id);
  if (actor.role === "worker") throw forbidden("工作 agent 不能查看執行紀錄");
  const [named] = await withAgentNames([run]);
  const board = await boardsRepo.getById(run.board_id);
  return { ...named, board_title: board?.title ?? "" };
}

// 讀 log：前端從 offset 開始輪詢；PM 用 tail 看最後一段
export async function readLog(runId, { offset = 0, tail } = {}, actor) {
  const run = await runsRepo.getById(runId);
  if (!run) throw notFound("找不到執行紀錄");
  assertBoardAccess(actor, run.board_id);
  if (actor.role === "worker") throw forbidden("工作 agent 不能查看執行紀錄");
  const running = live.has(runId);
  const file = logPath(runId);
  if (!existsSync(file)) return { text: "", offset: 0, running, status: run.status };

  const size = statSync(file).size;
  const tailBytes = clampInt(tail, 0, LOG_CHUNK, 0);
  const start = tailBytes ? Math.max(0, size - tailBytes) : Math.min(Math.max(0, Number(offset) || 0), size);
  const length = Math.min(size - start, LOG_CHUNK);
  let chunk = Buffer.alloc(length);
  if (length > 0) {
    const fd = openSync(file, "r");
    try {
      readSync(fd, chunk, 0, length, start);
    } finally {
      closeSync(fd);
    }
  }
  // 還沒讀到檔尾或還在寫時，切在最後一個換行，避免把中文字切一半
  if (start + length < size || running) {
    const cut = chunk.lastIndexOf(0x0a);
    if (cut >= 0) chunk = chunk.subarray(0, cut + 1);
    else if (length < LOG_CHUNK) chunk = chunk.subarray(0, 0);
  }
  return { text: chunk.toString("utf8"), offset: start + chunk.length, running, status: run.status };
}

let modelCache = { at: 0, models: [] };

export async function listModels() {
  if (!modelCache.models.length || Date.now() - modelCache.at > 10 * 60 * 1000) {
    try {
      const res = await fetch(`${config.anthropic.baseUrl}/v1/models?limit=100`, {
        headers: { "x-api-key": config.anthropic.apiKey, "anthropic-version": config.anthropic.version },
        signal: AbortSignal.timeout(15000)
      });
      if (res.ok) {
        const json = await res.json();
        modelCache = {
          at: Date.now(),
          models: (json.data ?? []).map((m) => ({ id: m.id, name: m.display_name || m.id }))
        };
      }
    } catch (err) {
      logError(err);
    }
  }
  const models = modelCache.models.length ? modelCache.models : [{ id: config.defaultModel, name: config.defaultModel }];
  return { default: config.defaultModel, models };
}

export async function shutdown() {
  for (const job of jobs.values()) job.stop();
  for (const entry of live.values()) {
    entry.killedBy = "伺服器關閉";
    await killTree(entry.child.pid);
  }
}
