import { mkdir } from "node:fs/promises";
import path from "node:path";
import { Cron } from "croner";
import { assertBoardAccess } from "../lib/access.js";
import { emit } from "../lib/bus.js";
import { config } from "../lib/config.js";
import { badRequest, notFound } from "../lib/errors.js";
import { byId, clampInt, text, toStringList, uniq } from "../lib/util.js";
import { ensureAgentUser } from "../handlers/agent-user.handler.js";
import { getBoardContext } from "../handlers/board-context.handler.js";
import * as boardsRepo from "../repos/boards.repo.js";
import * as skillsRepo from "../repos/skills.repo.js";
import * as ticketsRepo from "../repos/tickets.repo.js";
import * as usersRepo from "../repos/users.repo.js";

function toCounts(rows) {
  const counts = { todo: 0, doing: 0, pending: 0, done: 0, close: 0 };
  for (const row of rows) counts[row.status] = row.count;
  return counts;
}

async function checkSkills(value) {
  const names = toStringList(value);
  const found = new Set((await skillsRepo.getByNames(names)).map((s) => s.name));
  const missing = names.filter((n) => !found.has(n));
  if (missing.length) throw badRequest(`找不到這些 skill：${missing.join(", ")}`);
  return names;
}

function checkCron(value) {
  const expr = text(value, { label: "cron", max: 100, required: true });
  try {
    new Cron(expr, { paused: true }).stop();
  } catch {
    throw badRequest(`cron 格式錯誤：${expr}`);
  }
  return expr;
}

async function ensureFolder(folder) {
  try {
    await mkdir(folder, { recursive: true });
  } catch (err) {
    throw badRequest(`無法建立資料夾 ${folder}：${err.message}`);
  }
}

async function normalize(input) {
  const out = {};
  if (input.title !== undefined) out.title = text(input.title, { label: "標題", max: 100, required: true });
  if (input.description !== undefined) out.description = text(input.description, { label: "說明", max: 5000 });
  if (input.folder !== undefined) {
    const folder = text(input.folder, { label: "資料夾", max: 500 });
    if (folder) out.folder = path.resolve(folder);
  }
  if (input.pm_prompt !== undefined) out.pm_prompt = text(input.pm_prompt, { label: "PM prompt", max: 20000 });
  if (input.pm_skills !== undefined) out.pm_skills = await checkSkills(input.pm_skills);
  if (input.allowed_skills !== undefined) out.allowed_skills = await checkSkills(input.allowed_skills);
  if (input.cron !== undefined) out.cron = checkCron(input.cron);
  if (input.pm_model !== undefined) out.pm_model = text(input.pm_model, { label: "PM 模型", max: 100 });
  if (input.worker_model !== undefined) out.worker_model = text(input.worker_model, { label: "工作 agent 模型", max: 100 });
  if (input.max_workers !== undefined) out.max_workers = clampInt(input.max_workers, 1, 10, 1);
  if (input.max_turns !== undefined) out.max_turns = clampInt(input.max_turns, 5, 200, 40);
  if (input.enabled !== undefined) out.enabled = Boolean(input.enabled);
  if (input.pm_name !== undefined) {
    const name = text(input.pm_name, { label: "PM 名字", max: 40, required: true });
    out.pm_user_id = (await ensureAgentUser(name)).id;
  }
  return out;
}

export async function list() {
  const boards = await boardsRepo.list();
  const users = byId(await usersRepo.getByIds(uniq(boards.map((b) => b.pm_user_id))));
  const out = [];
  for (const board of boards) {
    out.push({
      ...board,
      pm_name: users.get(board.pm_user_id)?.name ?? "?",
      counts: toCounts(await ticketsRepo.countByStatus(board.id))
    });
  }
  return out;
}

export async function get(id, actor) {
  assertBoardAccess(actor, id);
  const ctx = await getBoardContext(id);
  if (!ctx) throw notFound("找不到看板");
  return { ...ctx.board, pm_name: ctx.pmName, counts: toCounts(await ticketsRepo.countByStatus(id)) };
}

export async function create(input) {
  const data = await normalize({ cron: "*/5 * * * *", ...input });
  if (!data.title) throw badRequest("請填寫標題");
  if (!data.pm_user_id) data.pm_user_id = (await ensureAgentUser(`${data.title} PM`)).id;
  if (!data.folder) data.folder = path.join(config.workspaceDir, `board-${Date.now()}`);
  await ensureFolder(data.folder);
  const board = await boardsRepo.create(data);
  emit("board", { boardId: board.id });
  return board;
}

export async function update(id, input) {
  if (!(await boardsRepo.getById(id))) throw notFound("找不到看板");
  const data = await normalize(input);
  if (data.folder) await ensureFolder(data.folder);
  const board = await boardsRepo.update(id, data);
  emit("board", { boardId: id });
  return board;
}

export async function remove(id) {
  if (!(await boardsRepo.getById(id))) throw notFound("找不到看板");
  await boardsRepo.remove(id);
  emit("board", { boardId: id });
}
