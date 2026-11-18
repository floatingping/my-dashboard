# Agent 看板

看板驅動的 AI agent 系統。每個看板有一個 PM agent，照排程檢查票、派工作 agent 去做，做完由 PM 驗收並 git commit。

## 啟動

```cmd
npm install
npm start                  :: http://localhost:3001
npm run tunnel             :: ngrok http 3001 --url https://unhumid-less-simona.ngrok-free.dev
```

用 3001 是因為 3000 給 file-server 專案用；要換 port 就改 `.env` 的 `PORT` 和 `package.json` 的 `tunnel`。

第一次使用時，請在這台電腦開 http://localhost:3001 建立第一個人類帳號（從公開網址不能建立）。

## 怎麼運作

- **看板**：標題、說明、工作資料夾、PM（名字 + prompt + skills）、PM 可以下放的 skills、cron 排程、模型。
- **票**：狀態 `todo / doing / pending / done / close` 和 `result`。票即留言：開票的內容就是第一則留言。
- **權限**：人和 agent 只能開票、留言；只有該看板的 PM 能改狀態和 result。票和留言只能新增。
- **PM**：排程時間到就檢查（看板完全沒事時跳過）。
  - 看派出去的 agent 有沒有卡住，卡住就關掉。
  - 派新票給工作 agent。
  - 驗收做完的票（git diff、跑測試），通過就 git commit，再把票設成 done，result 附上 commit hash。
- **工作 agent**：一個行程完成一張票，只負責讀票、做事、交報告，不 commit。可以在網頁上看即時 log，也可以關掉。
- **問 PM**：看板頁的聊天面板，PM 會查看板資料再回答。
- **附件**：上傳後用 guid 存檔，PGlite 記錄 guid 和原檔名，用 `/api/files/{guid}` 讀取，留言裡直接貼圖。流程圖用 mermaid。

## 程式結構

```
server/
  controllers/  只處理 HTTP，呼叫 services
  services/     業務規則和權限，呼叫 handlers / repos
  handlers/     重複用到的多 repo 組合操作，只呼叫 repos
  repos/        單一資料表的 CRUD
  lib/          設定、PGlite、密碼、行程、事件（任何層都可以用）
  prompts/      PM / 工作 agent 的提示詞
  agent/        agent 子行程（只透過 HTTP API 跟伺服器溝通）
public/         HTML + Vue 3 + Tailwind（不需要建置）
data/           PGlite 資料庫、上傳檔、log（不進版控）
```

同一層的檔案互不 import。JS 字串只用 `"` 或樣板字串。

## 設定（.env）

| 變數 | 說明 |
|---|---|
| `PORT` | 目前是 3001（沒設定時是 3000） |
| `ANTHROPIC_API_KEY` | Anthropic API 金鑰 |
| `ANTHROPIC_VERSION` | API 版本 |
| `DEFAULT_MODEL` | 預設模型（`claude-haiku-5-5`），每個看板可以另外設定 |
| `GIT_PATH` | git 執行檔位置（不填會自動找，包含 `%LOCALAPPDATA%\Programs\MinGit`） |
