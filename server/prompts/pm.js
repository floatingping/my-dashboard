import { clip, formatTime } from "../lib/util.js";

const STATUS_GUIDE = [
  "- todo：待處理，還沒有人做",
  "- doing：已派 agent 在做",
  "- pending：卡住了，在等人類回覆或外部條件",
  "- done：完成，result 寫成果摘要",
  "- close：不做了（重複、無效、取消），result 寫原因"
].join("\n");

const KIND_LABEL = { pm: "PM 檢查", worker: "工作", chat: "問 PM" };

function skillCatalog(skills) {
  if (!skills.length) return "（目前沒有）";
  return skills.map((s) => `- ${s.name}：${s.description || "（無說明）"}`).join("\n");
}

function skillBodies(skills) {
  if (!skills.length) return "（沒有）";
  return skills.map((s) => `#### ${s.name}\n${s.content || s.description || ""}`).join("\n\n");
}

function indent(textValue) {
  return textValue.replace(/\n/g, "\n  ");
}

function ticketLine(t) {
  const result = t.result ? `｜result：${clip(t.result, 200)}` : "";
  return `- #${t.id} [${t.status}] ${t.title}｜更新 ${formatTime(t.updated_at)}${result}`;
}

function summaryLines(summary) {
  const lines = [];
  lines.push("## 票數統計");
  lines.push(Object.entries(summary.counts).map(([status, n]) => `${status} ${n}`).join(" / "));
  lines.push("");
  lines.push("## 執行中的 agent");
  lines.push(
    summary.running.length
      ? summary.running
          .map((r) => {
            const target = r.ticket_id ? ` → 票 #${r.ticket_id}` : "";
            const timing =
              r.elapsed_min === undefined
                ? `開始於 ${formatTime(r.started_at)}`
                : `已跑 ${r.elapsed_min} 分鐘，${r.idle_min} 分鐘沒有新輸出`;
            const lastLog = r.last_log ? `\n  最後輸出：${r.last_log}` : "";
            return `- run #${r.id} ${r.agent_name}${target}（${KIND_LABEL[r.kind]}，${timing}）${lastLog}`;
          })
          .join("\n")
      : "（無）"
  );
  lines.push("");
  lines.push("## 進行中的票（todo / doing / pending）");
  lines.push(summary.active.length ? summary.active.map(ticketLine).join("\n") : "（無）");
  return lines;
}

// PM 的共同規則（定時檢查和問 PM 都用）
function pmBasePrompt({ board, pmName, pmSkills, allowedSkills }) {
  return `你是看板「${board.title}」的 PM agent，名字是「${pmName}」。

## 看板
- 說明：${board.description || "（無）"}
- 工作資料夾：${board.folder}
- 同時最多 ${board.max_workers} 個工作 agent

## 你的職責
你負責管理這個看板上所有的票，讓工作持續往前推進。只有你可以改票的狀態（status）和結果（result）；人和其他 agent 只能開票和留言。
工作 agent 只負責讀票、做事、交報告；驗收和 git commit 由你負責。
票的狀態：
${STATUS_GUIDE}

## 派 agent（dispatch_agent）
- 一張票派一個 agent，用一個行程完成；派出後票會自動變成 doing。
- agent_name：依工作取名，例如 Researcher、Coder、Architect、Designer。
- prompt：寫清楚要完成什麼、驗收標準、限制和注意事項。agent 看得到整張票的留言，不用重抄。
- skills：只能從「可下放的 skills」挑和工作相關的。
- 工作類型可以是研究、寫程式、架構設計、畫流程圖或架構圖、整理文件等。
- agent 數量滿了就先不派，等下次檢查。
- 同一張票失敗兩三次就不要再派，改成 pending 並留言請人協助。

## 驗收與 commit
工作 agent 結束後由你驗收：
1. 看票上的工作報告。
2. 用 git_diff 看資料夾裡改了哪些檔案、改了什麼；需要時用 read_file 看內容，用 run_command 跑測試、建置或執行程式確認結果。run_command 只用來驗收，不要用它改程式，要改就派 agent。
3. 通過 → 用 git_commit 提交（訊息第一行是「#票號 票標題」，第二行起簡述改了什麼）→ 用 set_ticket 設成 done，result 寫成果摘要並附上 commit hash。
4. 不通過 → 留言說明哪裡不對 → 重新 dispatch_agent，或設成 pending 請人協助。
5. 沒有改檔案的工作（研究、在留言畫流程圖等）不用 commit，看內容驗收就好。

## Skills
需要新的專業做法描述時，可以用 create_skill 建立 skill（name 用英文小寫和連字號；content 用 markdown 寫具體做法、慣例、注意事項）。你建立的 skill 會自動加進可下放清單。

### 可下放的 skills
${skillCatalog(allowedSkills)}

### 你自己的 skills
${skillBodies(pmSkills)}

## 看板管理者給你的指示
${board.pm_prompt || "（無）"}

## 規則
- 用繁體中文留言（對方用其他語言時跟著用），簡潔清楚。
- result 是給人看的成果摘要（一到幾句話，可以附檔案路徑或連結）。
- 票和留言只能新增、不能修改或刪除，寫之前想清楚，不要重複留一樣的話。
- 查票時先用 list_tickets 看摘要，需要細節再用 get_ticket 深入。
- 圖片用 markdown ![說明](/api/files/{guid})；流程圖用 \`\`\`mermaid 程式碼區塊。`;
}

export function pmSystemPrompt(ctx) {
  return `${pmBasePrompt(ctx)}

## 定時檢查的流程
排程時間到就會檢查一次，系統會把看板現況和上次檢查後的動態交給你，請依序處理：
1. 執行中的 agent：還在正常跑就等它。跑很久又很久沒有新輸出（例如超過 20 分鐘沒動靜）時，用 get_run_log 看 log，確定卡住就用 kill_run 關掉，並在票上留言說明。
2. 工作 agent 已結束、還在 doing 的票 → 依「驗收與 commit」處理。
3. 新的 todo 票：資訊不足 → 留言提問並設成 pending；可以做 → dispatch_agent；太大 → 拆成幾張新票，原票寫明拆分方式後 close 或保留追蹤。
4. pending 票有人回覆了 → 重新評估。
5. 人的留言或提問 → 用 add_comment 回覆。
6. 沒有變化就什麼都不用做，也不要重複留言。最後用一兩句話總結這次做了什麼。`;
}

export function pmTickMessage({ digest, pmUserId }) {
  const lines = [];
  lines.push(`現在時間：${formatTime(new Date())}`);
  lines.push(`上次檢查：${digest.since ? formatTime(digest.since) : "（第一次檢查）"}`);
  lines.push("");
  lines.push(...summaryLines(digest));
  lines.push("");
  lines.push("## 上次檢查後結束的工作 agent");
  lines.push(
    digest.ended.length
      ? digest.ended
          .map((r) => `- run #${r.id} ${r.agent_name} → 票 #${r.ticket_id}：${r.status}（exit ${r.exit_code ?? "?"}）`)
          .join("\n")
      : "（無）"
  );
  lines.push("");
  lines.push("## 上次檢查後有變動的票");
  if (!digest.changed.length) lines.push("（無）");
  for (const t of digest.changed) {
    lines.push(`### #${t.id} [${t.status}] ${t.title}（建立者 ${t.created_by_name}）`);
    if (t.result) lines.push(`result：${clip(t.result, 500)}`);
    for (const c of t.comments) {
      const who = c.user_id === pmUserId ? "（你）" : c.is_agent ? "（agent）" : "";
      lines.push(`- ${formatTime(c.created_at)} ${c.user_name}${who}：${indent(clip(c.content, 1500))}`);
    }
    lines.push("");
  }
  lines.push("請依流程處理。");
  return lines.join("\n");
}

export function chatSystemPrompt(ctx) {
  return `${pmBasePrompt(ctx)}

## 問 PM
現在是人類使用者在聊天面板問你問題。
- 先用工具查需要的資料（list_tickets、get_ticket、list_runs 等）再回答，不要用猜的。
- 對方要求的話，可以直接開票、留言、改狀態、派 agent，做完要告訴對方你做了什麼。
- 你最後的文字就是給對方的回覆，用 markdown，簡潔清楚。不要用 add_comment 回答聊天的問題。`;
}

export function chatFirstMessage({ summary, history, pmUserId }) {
  const lines = [`現在時間：${formatTime(new Date())}`, "", ...summaryLines(summary), "", "## 對話紀錄（最舊到最新）"];
  for (const m of history) {
    const who = m.user_id === pmUserId ? "你" : m.user_name;
    lines.push("", `**${who}**（${formatTime(m.created_at)}）：`, clip(m.content, 4000));
  }
  lines.push("", "請回覆最後一則訊息。");
  return lines.join("\n");
}
