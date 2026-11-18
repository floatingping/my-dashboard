// agent 子行程：由伺服器啟動，一個行程跑完一次任務（PM 檢查 / 工作 agent / 問 PM）
// 只透過 HTTP API 跟伺服器溝通，輸出會寫進 log 檔給網頁看
import { readFileSync } from "node:fs";
import { createMessage } from "./anthropic.js";
import { buildTools, makeApi } from "./tools.js";

const cfg = JSON.parse(readFileSync(process.argv[2], "utf8"));
const anthropic = {
  apiKey: process.env.ANTHROPIC_API_KEY,
  version: process.env.ANTHROPIC_VERSION || "2023-06-01",
  baseUrl: process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com"
};
const ctx = {
  cwd: cfg.cwd,
  boardId: cfg.boardId,
  ticketId: cfg.ticketId,
  kind: cfg.kind,
  agentName: cfg.agentName,
  api: makeApi(process.env.KANBAN_API, process.env.KANBAN_TOKEN),
  state: { finished: false, report: "" }
};
const KIND_LABEL = { pm: "PM 定時檢查", worker: "工作 agent", chat: "問 PM" };

function log(icon, message) {
  const time = new Date().toLocaleTimeString("zh-TW", { hour12: false });
  process.stdout.write(`[${time}] ${icon} ${message}\n`);
}

function brief(value, max = 600) {
  const s = typeof value === "string" ? value : JSON.stringify(value);
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

// 只在最後一則訊息放快取斷點，前面的對話就能從快取讀
function withCacheBreakpoint(messages) {
  return messages.map((message, index) => {
    if (index !== messages.length - 1) return message;
    const content = typeof message.content === "string" ? [{ type: "text", text: message.content }] : [...message.content];
    content[content.length - 1] = { ...content[content.length - 1], cache_control: { type: "ephemeral" } };
    return { ...message, content };
  });
}

async function main() {
  const tools = buildTools(cfg.kind);
  const toolMap = new Map(tools.map((t) => [t.name, t]));
  const toolDefs = tools.map(({ name, description, input_schema }) => ({ name, description, input_schema }));
  const system = [{ type: "text", text: cfg.system, cache_control: { type: "ephemeral" } }];
  const messages = [{ role: "user", content: cfg.first }];
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

  log("▶", `run #${cfg.runId}｜${KIND_LABEL[cfg.kind]}｜模型 ${cfg.model}｜最多 ${cfg.maxTurns} 回合｜資料夾 ${cfg.cwd}`);

  let finalText = "";
  let turns = 0;
  while (turns < cfg.maxTurns && !ctx.state.finished) {
    turns += 1;
    const res = await createMessage(
      { model: cfg.model, max_tokens: 8192, system, tools: toolDefs, messages: withCacheBreakpoint(messages) },
      anthropic
    );
    usage.input += res.usage?.input_tokens ?? 0;
    usage.output += res.usage?.output_tokens ?? 0;
    usage.cacheRead += res.usage?.cache_read_input_tokens ?? 0;
    usage.cacheWrite += res.usage?.cache_creation_input_tokens ?? 0;
    messages.push({ role: "assistant", content: res.content });

    const textOut = res.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    if (textOut) log("💬", textOut);

    const calls = res.content.filter((b) => b.type === "tool_use");
    if (res.stop_reason !== "tool_use" || !calls.length) {
      finalText = textOut;
      break;
    }

    const results = [];
    for (const call of calls) {
      log("🔧", `${call.name} ${brief(call.input, 500)}`);
      const tool = toolMap.get(call.name);
      try {
        if (!tool) throw new Error(`沒有這個工具：${call.name}`);
        const output = (await tool.run(call.input ?? {}, ctx)) || "（完成）";
        log("✅", brief(typeof output === "string" ? output : "（圖片）", 800));
        results.push({ type: "tool_result", tool_use_id: call.id, content: output });
      } catch (err) {
        log("❌", `${call.name}：${err.message}`);
        results.push({ type: "tool_result", tool_use_id: call.id, content: `錯誤：${err.message}`, is_error: true });
      }
    }
    messages.push({ role: "user", content: results });
  }

  log("📊", `${turns} 回合｜input ${usage.input}｜output ${usage.output}｜cache 讀 ${usage.cacheRead}｜cache 寫 ${usage.cacheWrite}`);
  await wrapUp(finalText, turns);
}

// 工作 agent 的報告變成票上的留言；問 PM 的最後文字變成聊天回覆
async function wrapUp(finalText, turns) {
  if (cfg.kind === "worker") {
    let report = ctx.state.report || finalText;
    if (!ctx.state.finished && turns >= cfg.maxTurns) {
      report = `⏱️ 已達回合上限（${cfg.maxTurns}），工作可能還沒完成。\n\n${report}`;
    }
    await ctx.api("POST", `/tickets/${cfg.ticketId}/comments`, {
      content: `📋 **工作報告**\n\n${report || "（agent 沒有留下報告）"}`
    });
    log("📋", "已送出工作報告");
  } else if (cfg.kind === "chat") {
    await ctx.api("POST", `/boards/${cfg.boardId}/chat`, { content: finalText || "（沒有回覆內容）" });
    log("💬", "已送出回覆");
  }
}

function exit(code) {
  log("■", code === 0 ? "結束" : "失敗結束");
  process.stdout.write("", () => process.exit(code));
}

main()
  .then(() => exit(0))
  .catch((err) => {
    log("💥", err.stack || err.message);
    exit(1);
  });
