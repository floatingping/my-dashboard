import express from "express";
import { config } from "./lib/config.js";
import { db, migrate } from "./lib/db.js";
import { AppError } from "./lib/errors.js";
import { buildRouter } from "./routes.js";
import * as agentsService from "./services/agents.service.js";

await migrate();

const app = express();
// 只信任本機的 ngrok，req.ip 才會是真正的連線來源，X-Forwarded-For 偽造不了
app.set("trust proxy", "loopback");
app.disable("x-powered-by");
app.use(express.json({ limit: "5mb" }));

app.use("/api", buildRouter());
app.use("/api", (req, res) => res.status(404).json({ error: "找不到這個 API" }));

// 瀏覽器用的函式庫（Vue、Tailwind、marked、DOMPurify、mermaid），只開放指定資料夾
for (const [name, dir] of Object.entries(config.vendorDirs)) {
  app.use(`/vendor/${name}`, express.static(dir, { maxAge: "7d" }));
}
// HTML 頁面：/board?id=1 會對應到 public/board.html
app.use(express.static(config.publicDir, { extensions: ["html"] }));
app.use((req, res) => res.status(404).type("text/plain; charset=utf-8").send("找不到頁面"));

app.use((err, req, res, next) => {
  let status = 500;
  if (err instanceof AppError) status = err.status;
  else if (err.code === "LIMIT_FILE_SIZE") status = 413;
  else if (err.type === "entity.parse.failed" || err.name === "MulterError") status = 400;
  if (status >= 500) console.error(err);
  const message = status === 413 ? "檔案太大了" : status >= 500 ? "伺服器錯誤" : err.message;
  res.status(status).json({ error: message });
});

await agentsService.init();

const server = app.listen(config.port, () => {
  console.log(`看板系統已啟動：http://localhost:${config.port}`);
});

// 正常關閉資料庫，不然 PGlite 的流水號下次啟動會跳號
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  console.log("關閉中…");
  await agentsService.shutdown();
  server.close();
  await db.close().catch(() => {});
  process.exit(0);
}
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"]) process.on(signal, stop);
