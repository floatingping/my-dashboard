import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { runFile, runShell } from "../lib/proc.js";

const MAX_OUTPUT = 20000;
const STATUSES = ["todo", "doing", "pending", "done", "close"];
const SKIP_DIRS = new Set(["node_modules", ".git", "bin", "obj", "dist", ".vs", ".idea", "__pycache__", ".next", "coverage"]);
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
const MIME_BY_EXT = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".json": "application/json",
  ".csv": "text/csv",
  ".html": "text/html",
  ".zip": "application/zip"
};

function clip(value, max = MAX_OUTPUT) {
  if (value.length <= max) return value;
  const head = Math.floor(max * 0.4);
  return `${value.slice(0, head)}\n\n…（中間省略 ${value.length - max} 個字）…\n\n${value.slice(-(max - head))}`;
}

// 檔案工具只能碰工作資料夾裡面的路徑
function inside(cwd, target) {
  const full = path.resolve(cwd, String(target ?? "."));
  const rel = path.relative(cwd, full);
  if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error(`路徑必須在工作資料夾內：${target}`);
  return full;
}

function guidOf(value) {
  const match = String(value ?? "").match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  if (!match) throw new Error("找不到檔案的 guid");
  return match[0];
}

function fmtTime(value) {
  return value ? new Date(value).toLocaleString("zh-TW", { hour12: false }) : "";
}

// run_command 的環境變數拿掉 API 金鑰和 token，避免被指令印出來；並把 git 加進 PATH
function commandEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^(ANTHROPIC_|KANBAN_)/.test(key)) delete env[key];
  }
  const gitPath = process.env.GIT_PATH;
  if (gitPath && path.isAbsolute(gitPath)) {
    const pathKey = Object.keys(env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
    env[pathKey] = `${path.dirname(gitPath)}${path.delimiter}${env[pathKey] ?? ""}`;
  }
  return env;
}

function git(ctx, args, { input, timeoutMs = 60000 } = {}) {
  const gitPath = process.env.GIT_PATH || "git";
  return runFile(gitPath, ["-c", "core.quotepath=false", "-c", "safe.directory=*", ...args], {
    cwd: ctx.cwd,
    env: commandEnv(),
    timeoutMs,
    input
  });
}

async function isGitRepo(ctx) {
  const result = await git(ctx, ["rev-parse", "--is-inside-work-tree"]);
  return result.code === 0 && result.stdout.trim() === "true";
}

function htmlToText(html) {
  return html
    .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

function ticketLine(t) {
  const result = t.result ? `｜result：${t.result.slice(0, 200)}` : "";
  return `#${t.id} [${t.status}] ${t.title}｜建立 ${fmtTime(t.created_at)} by ${t.created_by_name}｜更新 ${fmtTime(t.updated_at)}${result}`;
}

function ticketThread(t) {
  const lines = [
    `# 票 #${t.id}：${t.title}`,
    `狀態：${t.status}`,
    `result：${t.result || "（無）"}`,
    `建立：${t.created_by_name}，${fmtTime(t.created_at)}｜更新：${fmtTime(t.updated_at)}`,
    "",
    "## 留言"
  ];
  for (const c of t.comments) {
    lines.push("", `### ${c.user_name}${c.is_agent ? "（agent）" : ""}｜${fmtTime(c.created_at)}`, c.content);
  }
  if (t.runs?.length) {
    lines.push("", "## agent 執行紀錄");
    for (const r of t.runs) lines.push(`- run #${r.id} ${r.agent_name}：${r.status}`);
  }
  return clip(lines.join("\n"), 40000);
}

// 呼叫看板 API（帶這次執行專用的 token，權限由伺服器檢查）
export function makeApi(apiBase, token) {
  return async function api(method, url, body, { form, raw } = {}) {
    const init = { method, headers: { authorization: `Bearer ${token}` } };
    if (form) {
      init.body = form;
    } else if (body !== undefined) {
      init.headers["content-type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    const res = await fetch(`${apiBase}${url}`, init);
    if (raw && res.ok) return res;
    const type = res.headers.get("content-type") || "";
    const data = type.includes("application/json") ? await res.json() : await res.text();
    if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
    return data;
  };
}

const TOOLS = {
  list_dir: {
    description: "列出工作資料夾裡的檔案和子資料夾（會略過 node_modules、.git、bin、obj 等）。",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "相對於工作資料夾的路徑，預設是 ." },
        depth: { type: "integer", description: "往下列幾層，預設 2，最多 5" }
      }
    },
    async run({ path: target = ".", depth = 2 }, ctx) {
      const root = inside(ctx.cwd, target);
      const maxDepth = Math.min(Math.max(1, Number(depth) || 2), 5);
      const lines = [];
      async function walk(dir, level, prefix) {
        let entries;
        try {
          entries = await readdir(dir, { withFileTypes: true });
        } catch (err) {
          lines.push(`${prefix}（無法讀取：${err.message}）`);
          return;
        }
        entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
        for (const entry of entries) {
          if (lines.length >= 500) {
            lines.push(`${prefix}…（項目太多，只列前 500 項）`);
            return;
          }
          if (entry.isDirectory()) {
            if (SKIP_DIRS.has(entry.name)) {
              lines.push(`${prefix}${entry.name}/（略過）`);
              continue;
            }
            lines.push(`${prefix}${entry.name}/`);
            if (level < maxDepth) await walk(path.join(dir, entry.name), level + 1, `${prefix}  `);
          } else {
            const info = await stat(path.join(dir, entry.name)).catch(() => null);
            lines.push(`${prefix}${entry.name}${info ? `（${info.size} bytes）` : ""}`);
          }
        }
      }
      await walk(root, 1, "");
      return lines.length ? lines.join("\n") : "（空的資料夾）";
    }
  },

  read_file: {
    description: "讀取工作資料夾裡的文字檔，回傳加上行號的內容。大檔案可以用 offset / limit 分段讀。",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string" },
        offset: { type: "integer", description: "從第幾行開始（從 1 開始），預設 1" },
        limit: { type: "integer", description: "最多讀幾行，預設 400" }
      },
      required: ["path"]
    },
    async run({ path: target, offset = 1, limit = 400 }, ctx) {
      const buffer = await readFile(inside(ctx.cwd, target));
      if (buffer.includes(0)) return `（二進位檔，${buffer.length} bytes，無法用文字顯示）`;
      const lines = buffer.toString("utf8").split(/\r?\n/);
      const start = Math.max(1, Number(offset) || 1);
      const count = Math.min(Math.max(1, Number(limit) || 400), 2000);
      const body = lines
        .slice(start - 1, start - 1 + count)
        .map((line, i) => `${String(start + i).padStart(5)}| ${line}`)
        .join("\n");
      const tail = start - 1 + count < lines.length ? `\n…（共 ${lines.length} 行，後面還有）` : `\n（共 ${lines.length} 行）`;
      return clip(body + tail, 40000);
    }
  },

  write_file: {
    description: "建立或覆寫工作資料夾裡的檔案（會自動建立上層資料夾）。",
    input_schema: {
      type: "object",
      properties: { path: { type: "string" }, content: { type: "string" } },
      required: ["path", "content"]
    },
    async run({ path: target, content }, ctx) {
      const file = inside(ctx.cwd, target);
      const textValue = String(content ?? "");
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, textValue, "utf8");
      return `已寫入 ${path.relative(ctx.cwd, file)}（${textValue.length} 個字元）`;
    }
  },

  edit_file: {
    description: "修改檔案：把 old_string 換成 new_string。old_string 必須和檔案內容完全一致而且只出現一次，否則請設定 replace_all。",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string" },
        old_string: { type: "string" },
        new_string: { type: "string" },
        replace_all: { type: "boolean" }
      },
      required: ["path", "old_string", "new_string"]
    },
    async run({ path: target, old_string: oldText, new_string: newText, replace_all: all = false }, ctx) {
      if (!oldText) throw new Error("old_string 不能是空的");
      const file = inside(ctx.cwd, target);
      const original = await readFile(file, "utf8");
      let search = String(oldText);
      let replacement = String(newText ?? "");
      // Windows 換行的檔案：模型給的通常是 \n，改成 \r\n 再找一次
      if (!original.includes(search) && original.includes("\r\n")) {
        search = search.replace(/\r?\n/g, "\r\n");
        replacement = replacement.replace(/\r?\n/g, "\r\n");
      }
      const count = original.split(search).length - 1;
      if (count === 0) throw new Error("找不到 old_string，請先用 read_file 確認內容");
      if (count > 1 && !all) throw new Error(`old_string 出現 ${count} 次，請多帶一些上下文讓它唯一，或設定 replace_all`);
      const updated = all ? original.split(search).join(replacement) : original.replace(search, () => replacement);
      await writeFile(file, updated, "utf8");
      return `已修改 ${path.relative(ctx.cwd, file)}（換了 ${all ? count : 1} 處）`;
    }
  },

  run_command: {
    description: "在工作資料夾執行 shell 指令（Windows 是 cmd.exe），回傳 exit code 和輸出。不要執行會一直跑不結束的指令。",
    input_schema: {
      type: "object",
      properties: {
        command: { type: "string" },
        timeout_sec: { type: "integer", description: "逾時秒數，預設 120，最多 900" }
      },
      required: ["command"]
    },
    async run({ command, timeout_sec: timeoutSec = 120 }, ctx) {
      const seconds = Math.min(Math.max(1, Number(timeoutSec) || 120), 900);
      const { code, output, timedOut } = await runShell(String(command), {
        cwd: ctx.cwd,
        timeoutMs: seconds * 1000,
        env: commandEnv()
      });
      const head = timedOut ? `exit code：${code}（超過 ${seconds} 秒，已終止）` : `exit code：${code}`;
      return `${head}\n${clip(output.trim() || "（沒有輸出）")}`;
    }
  },

  web_fetch: {
    description: "抓取網頁或 API 的內容（HTML 會轉成純文字），用來研究資料。",
    input_schema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
    async run({ url }) {
      const target = new URL(String(url));
      if (!["http:", "https:"].includes(target.protocol)) throw new Error("只支援 http / https");
      const res = await fetch(target, {
        headers: { "user-agent": "Mozilla/5.0 (kanban-agent)" },
        signal: AbortSignal.timeout(30000)
      });
      const type = res.headers.get("content-type") || "";
      if (!/text|json|xml|javascript/.test(type)) return `HTTP ${res.status}，內容類型 ${type}，不是文字，略過`;
      let body = await res.text();
      if (type.includes("html")) body = htmlToText(body);
      return `HTTP ${res.status} ${target.href}\n\n${clip(body)}`;
    }
  },

  list_tickets: {
    description: "查看板上的票，只回摘要（編號、狀態、標題、result、時間）。可以用狀態、時間區間、關鍵字篩選。要看完整留言請用 get_ticket。",
    input_schema: {
      type: "object",
      properties: {
        status: { type: "array", items: { type: "string", enum: STATUSES }, description: "要查的狀態，不填就是全部" },
        from: { type: "string", description: "開始時間（ISO 格式，例如 2026-11-01T00:00:00+08:00）" },
        to: { type: "string", description: "結束時間（ISO 格式）" },
        field: { type: "string", enum: ["updated", "created"], description: "時間區間比對更新時間或建立時間，預設 updated" },
        q: { type: "string", description: "關鍵字（比對標題和 result，也可以輸入 #編號）" },
        limit: { type: "integer", description: "最多幾筆，預設 50" }
      }
    },
    async run(input, ctx) {
      const params = new URLSearchParams();
      if (input.status?.length) params.set("status", [].concat(input.status).join(","));
      for (const key of ["from", "to", "field", "q"]) {
        if (input[key]) params.set(key, String(input[key]));
      }
      params.set("limit", String(Math.min(Number(input.limit) || 50, 200)));
      const rows = await ctx.api("GET", `/boards/${ctx.boardId}/tickets?${params}`);
      return rows.length ? rows.map(ticketLine).join("\n") : "（沒有符合的票）";
    }
  },

  get_ticket: {
    description: "看一張票的完整內容：所有留言和 agent 執行紀錄。",
    input_schema: {
      type: "object",
      properties: { id: { type: "integer", description: "票的編號" } },
      required: ["id"]
    },
    async run({ id }, ctx) {
      const ticketId = Number(id) || ctx.ticketId;
      return ticketThread(await ctx.api("GET", `/tickets/${ticketId}`));
    }
  },

  add_comment: {
    description: "在票上留言（markdown）。圖片用 ![說明](/api/files/{guid})，流程圖用 ```mermaid 程式碼區塊。",
    input_schema: {
      type: "object",
      properties: {
        ticket_id: { type: "integer", description: "票的編號（工作 agent 不填就是自己負責的票）" },
        content: { type: "string" }
      },
      required: ["content"]
    },
    async run({ ticket_id: ticketId, content }, ctx) {
      const id = Number(ticketId) || ctx.ticketId;
      if (!id) throw new Error("請指定 ticket_id");
      await ctx.api("POST", `/tickets/${id}/comments`, { content });
      return `已在票 #${id} 留言`;
    }
  },

  create_ticket: {
    description: "在這個看板開一張新票，content 就是票的第一則留言。",
    input_schema: {
      type: "object",
      properties: { title: { type: "string" }, content: { type: "string", description: "票的內容（markdown）" } },
      required: ["title", "content"]
    },
    async run({ title, content }, ctx) {
      const ticket = await ctx.api("POST", `/boards/${ctx.boardId}/tickets`, { title, content });
      return `已建立票 #${ticket.id}：${ticket.title}`;
    }
  },

  upload_file: {
    description: "把工作資料夾裡的檔案上傳到看板，回傳網址和可以直接貼進留言的 markdown（圖片會直接顯示）。",
    input_schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
    async run({ path: target }, ctx) {
      const file = inside(ctx.cwd, target);
      const buffer = await readFile(file);
      const name = path.basename(file);
      const type = MIME_BY_EXT[path.extname(name).toLowerCase()] || "application/octet-stream";
      const form = new FormData();
      form.append("file", new Blob([buffer], { type }), name);
      const saved = await ctx.api("POST", "/files", undefined, { form });
      return `已上傳 ${name}\n網址：${saved.url}\nmarkdown：${saved.markdown}`;
    }
  },

  view_file: {
    description: "查看附件（/api/files/{guid}）。圖片會直接讓你看到，文字檔會回傳內容。",
    input_schema: {
      type: "object",
      properties: { guid: { type: "string", description: "檔案 guid 或 /api/files/{guid} 網址" } },
      required: ["guid"]
    },
    async run({ guid }, ctx) {
      const id = guidOf(guid);
      const meta = await ctx.api("GET", `/files/${id}/meta`);
      const header = `檔名：${meta.original_name}｜類型：${meta.mime}｜大小：${meta.size} bytes`;
      const isImage = IMAGE_TYPES.includes(meta.mime);
      const isText = /^text\/|json|xml|javascript|csv|markdown|svg/.test(meta.mime);
      if (!isImage && !isText) return `${header}\n（這種檔案無法直接查看，可以用 save_attachment 存進資料夾再處理）`;
      if (isImage && meta.size > 4 * 1024 * 1024) return `${header}\n（圖片超過 4MB，無法直接查看）`;
      const res = await ctx.api("GET", `/files/${id}`, undefined, { raw: true });
      const buffer = Buffer.from(await res.arrayBuffer());
      if (!isImage) return `${header}\n\n${clip(buffer.toString("utf8"), 40000)}`;
      return [
        { type: "text", text: header },
        { type: "image", source: { type: "base64", media_type: meta.mime, data: buffer.toString("base64") } }
      ];
    }
  },

  save_attachment: {
    description: "把附件（/api/files/{guid}）下載存進工作資料夾。",
    input_schema: {
      type: "object",
      properties: {
        guid: { type: "string", description: "檔案 guid 或 /api/files/{guid} 網址" },
        path: { type: "string", description: "要存的路徑（相對於工作資料夾），不填就用原檔名" }
      },
      required: ["guid"]
    },
    async run({ guid, path: target }, ctx) {
      const id = guidOf(guid);
      const meta = await ctx.api("GET", `/files/${id}/meta`);
      const file = inside(ctx.cwd, target || path.basename(meta.original_name));
      const res = await ctx.api("GET", `/files/${id}`, undefined, { raw: true });
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, Buffer.from(await res.arrayBuffer()));
      return `已存到 ${path.relative(ctx.cwd, file)}`;
    }
  },

  finish: {
    description: "工作完成（或確定做不了）時呼叫。report 會成為票上的留言：寫清楚做了什麼、成果在哪、怎麼驗證、還有什麼問題。",
    input_schema: { type: "object", properties: { report: { type: "string" } }, required: ["report"] },
    async run({ report }, ctx) {
      ctx.state.finished = true;
      ctx.state.report = String(report ?? "");
      return "已收到報告，工作結束。";
    }
  },

  set_ticket: {
    description: "改票的狀態和 / 或 result（只有 PM 可以用）。",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "integer", description: "票的編號" },
        status: { type: "string", enum: STATUSES },
        result: { type: "string", description: "成果摘要或關閉原因" }
      },
      required: ["id"]
    },
    async run({ id, status, result }, ctx) {
      const body = {};
      if (status) body.status = status;
      if (result !== undefined) body.result = result;
      if (!Object.keys(body).length) throw new Error("請至少給 status 或 result");
      const ticket = await ctx.api("PATCH", `/tickets/${Number(id)}`, body);
      return `票 #${ticket.id} 現在是 [${ticket.status}]${ticket.result ? `，result：${ticket.result.slice(0, 200)}` : ""}`;
    }
  },

  dispatch_agent: {
    description: "派一個工作 agent 去完成一張票（一個行程做完一張票），派出後票會自動變成 doing。",
    input_schema: {
      type: "object",
      properties: {
        ticket_id: { type: "integer" },
        agent_name: { type: "string", description: "agent 名字，例如 Coder、Researcher、Architect" },
        prompt: { type: "string", description: "要完成什麼、驗收標準、注意事項" },
        skills: { type: "array", items: { type: "string" }, description: "要給的 skills（只能從可下放清單挑）" }
      },
      required: ["ticket_id", "agent_name", "prompt"]
    },
    async run(input, ctx) {
      const run = await ctx.api("POST", `/boards/${ctx.boardId}/dispatch`, input);
      return `已派 ${run.agent_name} 處理票 #${run.ticket_id}（run #${run.id}，模型 ${run.model}）`;
    }
  },

  git_diff: {
    description: "驗收用：看工作資料夾目前有哪些檔案被修改、新增或刪除（git status），以及改了什麼內容（git diff）。",
    input_schema: {
      type: "object",
      properties: { path: { type: "string", description: "只看某個檔案或子資料夾（相對路徑），不填就是全部" } }
    },
    async run({ path: target }, ctx) {
      const scope = target ? path.relative(ctx.cwd, inside(ctx.cwd, target)) || "." : ".";
      if (!(await isGitRepo(ctx))) {
        return "這個資料夾還不是 git repo（第一次 git_commit 時會自動建立），所以沒有 diff，可以用 list_dir / read_file 檢查檔案。";
      }
      const status = await git(ctx, ["status", "--short", "--untracked-files=all", "--", scope]);
      if (status.code !== 0) throw new Error(`git status 失敗：${status.stderr || status.stdout}`);
      if (!status.stdout.trim()) return "沒有任何變更（工作資料夾和最後一次 commit 相同）。";

      const parts = [`## git status\n${status.stdout.trim()}`];
      const hasHead = (await git(ctx, ["rev-parse", "--verify", "HEAD"])).code === 0;
      if (hasHead) {
        const stat = await git(ctx, ["diff", "HEAD", "--stat", "--", scope]);
        const diff = await git(ctx, ["diff", "HEAD", "--", scope]);
        if (stat.stdout.trim()) parts.push(`## 變更統計\n${stat.stdout.trim()}`);
        if (diff.stdout.trim()) parts.push(`## diff\n${diff.stdout}`);
      } else {
        parts.push("（還沒有任何 commit，上面的檔案都是新的）");
      }
      parts.push("新增（??）的檔案不會出現在 diff 裡，需要時用 read_file 看內容。");
      return clip(parts.join("\n\n"), 30000);
    }
  },

  git_commit: {
    description: "驗收通過後，把工作資料夾的變更 git commit（會先 git add 全部變更；還不是 repo 會自動 git init）。回傳 commit hash。",
    input_schema: {
      type: "object",
      properties: { message: { type: "string", description: "第一行「#票號 票標題」，第二行起簡述改了什麼" } },
      required: ["message"]
    },
    async run({ message }, ctx) {
      const text = String(message ?? "").trim();
      if (!text) throw new Error("請寫 commit 訊息");
      const runs = await ctx.api("GET", `/boards/${ctx.boardId}/runs?limit=50`);
      const busy = runs.filter((r) => r.live && r.kind === "worker");
      if (busy.length) {
        const names = busy.map((r) => `run #${r.id} ${r.agent_name}`).join("、");
        throw new Error(`還有 agent 在工作（${names}），等它結束再 commit，避免把做到一半的檔案一起提交`);
      }
      if (!(await isGitRepo(ctx))) {
        const init = await git(ctx, ["init", "-b", "main"]);
        if (init.code !== 0) throw new Error(`git init 失敗：${init.stderr || init.stdout}`);
      }
      const add = await git(ctx, ["add", "-A", "--", "."]);
      if (add.code !== 0) throw new Error(`git add 失敗：${add.stderr || add.stdout}`);
      const status = await git(ctx, ["status", "--short", "--", "."]);
      if (!status.stdout.trim()) return "沒有任何變更，不需要 commit。";

      // 只提交這個資料夾底下的變更；作者是 PM
      const commit = await git(
        ctx,
        ["-c", `user.name=${ctx.agentName || "PM"}`, "-c", "user.email=pm@kanban.local", "commit", "-F", "-", "--", "."],
        { input: text }
      );
      if (commit.code !== 0) throw new Error(`git commit 失敗：${commit.stderr || commit.stdout}`);
      const hash = (await git(ctx, ["rev-parse", "--short", "HEAD"])).stdout.trim();
      const stat = await git(ctx, ["show", "--stat", "--format=", "HEAD"]);
      return `已 commit ${hash}\n${clip(stat.stdout.trim(), 4000)}`;
    }
  },

  get_run_log: {
    description: "看某個 agent 執行的 log 最後一段，用來判斷它是不是卡住了。",
    input_schema: {
      type: "object",
      properties: {
        run_id: { type: "integer" },
        bytes: { type: "integer", description: "要看最後多少位元組，預設 6000" }
      },
      required: ["run_id"]
    },
    async run({ run_id: runId, bytes = 6000 }, ctx) {
      const tail = Math.min(Math.max(500, Number(bytes) || 6000), 50000);
      const log = await ctx.api("GET", `/runs/${Number(runId)}/log?tail=${tail}`);
      const state = log.running ? "執行中" : log.status;
      return `run #${runId}（${state}）最後的 log：\n${log.text || "（沒有內容）"}`;
    }
  },

  list_runs: {
    description: "列出這個看板最近的 agent 執行紀錄（含執行中的）。",
    input_schema: { type: "object", properties: { limit: { type: "integer", description: "預設 20" } } },
    async run({ limit = 20 }, ctx) {
      const runs = await ctx.api("GET", `/boards/${ctx.boardId}/runs?limit=${Math.min(Number(limit) || 20, 100)}`);
      if (!runs.length) return "（沒有紀錄）";
      return runs
        .map((r) => {
          const target = r.ticket_id ? ` → 票 #${r.ticket_id}` : "";
          const ended = r.ended_at ? `｜結束 ${fmtTime(r.ended_at)}` : "";
          return `run #${r.id} [${r.status}] ${r.kind} ${r.agent_name}${target}｜開始 ${fmtTime(r.started_at)}${ended}`;
        })
        .join("\n");
    }
  },

  kill_run: {
    description: "關掉一個執行中的工作 agent。",
    input_schema: { type: "object", properties: { run_id: { type: "integer" } }, required: ["run_id"] },
    async run({ run_id: runId }, ctx) {
      const result = await ctx.api("POST", `/runs/${Number(runId)}/kill`);
      return result.message;
    }
  },

  list_skills: {
    description: "列出所有 skill，並標示哪些可以下放給工作 agent。",
    input_schema: { type: "object", properties: {} },
    async run(input, ctx) {
      const skills = await ctx.api("GET", "/skills");
      const board = await ctx.api("GET", `/boards/${ctx.boardId}`);
      const allowed = new Set(board.allowed_skills);
      if (!skills.length) return "（還沒有任何 skill）";
      return skills
        .map((s) => `- ${s.name}${allowed.has(s.name) ? "（可下放）" : ""}：${s.description || "（無說明）"}`)
        .join("\n");
    }
  },

  create_skill: {
    description: "建立新的 skill（給 agent 的專業做法說明），建立後會自動加進這個看板的可下放清單。",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "英文小寫加連字號，例如 nodejs-express" },
        description: { type: "string", description: "一句話說明" },
        content: { type: "string", description: "markdown：具體做法、慣例、注意事項" }
      },
      required: ["name", "description", "content"]
    },
    async run(input, ctx) {
      const skill = await ctx.api("POST", "/skills", input);
      return `已建立 skill「${skill.name}」，現在可以下放了`;
    }
  }
};

const PM_TOOLS = [
  "list_tickets",
  "get_ticket",
  "set_ticket",
  "add_comment",
  "create_ticket",
  "dispatch_agent",
  "list_runs",
  "get_run_log",
  "kill_run",
  "list_skills",
  "create_skill",
  "list_dir",
  "read_file",
  "view_file",
  "git_diff",
  "run_command",
  "git_commit"
];

const TOOL_SETS = {
  worker: [
    "list_dir",
    "read_file",
    "write_file",
    "edit_file",
    "run_command",
    "web_fetch",
    "list_tickets",
    "get_ticket",
    "add_comment",
    "create_ticket",
    "upload_file",
    "view_file",
    "save_attachment",
    "finish"
  ],
  pm: PM_TOOLS,
  chat: PM_TOOLS
};

export function buildTools(kind) {
  return (TOOL_SETS[kind] ?? []).map((name) => ({ name, ...TOOLS[name] }));
}
