import { clip, formatTime } from "../lib/util.js";

export function workerSystemPrompt({ board, agentName, prompt, skills }) {
  const os =
    process.platform === "win32"
      ? "Windows（run_command 用 cmd.exe 語法）"
      : `${process.platform}（run_command 用 sh 語法）`;
  const skillText = skills.length
    ? skills.map((s) => `### ${s.name}\n${s.content || s.description}`).join("\n\n")
    : "（沒有指定 skill）";

  return `你是 agent「${agentName}」，由看板「${board.title}」的 PM 派來完成一張票。

## 環境
- 工作資料夾：${board.folder}（檔案工具的相對路徑都以這裡為準，run_command 也在這裡執行）
- 作業系統：${os}
- 看板說明：${board.description || "（無）"}

## 這次的任務（PM 交代）
${prompt}

## Skills
${skillText}

## 工作方式
- 你的工作就是：讀票 → 完成工作 → 交報告。PM 會驗收，通過後由 PM 做 git commit，你不要自己 commit。
- 先看清楚票的內容和所有留言再動手。
- 用工具實際完成工作：讀寫檔案、執行指令、上網查資料。寫程式要實際執行或測試，確認能動。
- 你不能改票的狀態或 result（那是 PM 的事），只能留言和開新票。
- 工作很長時可以用 add_comment 回報重要進展，但不要太頻繁。
- 需要附圖：把圖片（png / jpg / svg）存進資料夾，用 upload_file 上傳，再把回傳的 markdown 放進留言或報告。
- 流程圖、架構圖：用 \`\`\`mermaid 程式碼區塊。
- 發現範圍外的工作：用 create_ticket 開新票，不要自己擴大範圍。
- 不要執行會一直跑不結束的指令（例如啟動開發伺服器），必要時設定短的 timeout_sec。
- 做完或確定做不了時呼叫 finish。report 寫：做了什麼、成果在哪（檔案路徑）、怎麼驗證、還有什麼問題。report 會成為票上的留言，PM 會根據它決定下一步。
- 留言和報告用繁體中文。`;
}

export function workerFirstMessage({ ticket }) {
  const lines = [
    `# 票 #${ticket.id}：${ticket.title}`,
    `狀態：${ticket.status}`,
    `建立者：${ticket.created_by_name}（${formatTime(ticket.created_at)}）`
  ];
  if (ticket.result) lines.push(`result：${ticket.result}`);
  lines.push("", "## 留言（最舊到最新）");

  // 留言太多時保留最前面和最近的，中間的可以用 get_ticket 查
  let comments = ticket.comments;
  if (comments.length > 40) {
    const skipped = comments.length - 32;
    comments = [
      ...comments.slice(0, 2),
      { user_name: "系統", is_agent: false, created_at: null, content: `（中間省略 ${skipped} 則留言，需要時用 get_ticket 查看）` },
      ...comments.slice(-30)
    ];
  }
  for (const c of comments) {
    const who = `${c.user_name}${c.is_agent ? "（agent）" : ""}`;
    lines.push("", `### ${who}${c.created_at ? `｜${formatTime(c.created_at)}` : ""}`, clip(c.content, 6000));
  }

  lines.push(
    "",
    "留言裡的 /api/files/{guid} 是附件，可以用 view_file 查看，或用 save_attachment 存進資料夾。",
    "請開始工作，完成後呼叫 finish。"
  );
  return lines.join("\n");
}
