import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const envFile = path.join(root, ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const dataDir = path.resolve(root, process.env.DATA_DIR || "data");

// 剛用 winget 裝好的 git 不一定在目前行程的 PATH 裡，先找常見的安裝位置
function findGit() {
  if (process.env.GIT_PATH) return process.env.GIT_PATH;
  const candidates = [
    path.join(process.env.LOCALAPPDATA || "", "Programs", "MinGit", "cmd", "git.exe"),
    path.join(process.env.LOCALAPPDATA || "", "Programs", "Git", "cmd", "git.exe"),
    "C:\\Program Files\\Git\\cmd\\git.exe",
    "C:\\Program Files (x86)\\Git\\cmd\\git.exe"
  ];
  return candidates.find((p) => existsSync(p)) || "git";
}

export const config = {
  root,
  port: Number(process.env.PORT || 3000),
  dataDir,
  pgDir: path.join(dataDir, "pgdata"),
  uploadDir: path.join(dataDir, "uploads"),
  logDir: path.join(dataDir, "logs"),
  runDir: path.join(dataDir, "runs"),
  workspaceDir: path.join(dataDir, "workspaces"),
  publicDir: path.join(root, "public"),
  // 只開放這幾個瀏覽器用的函式庫資料夾，不會把整個 node_modules 公開
  vendorDirs: {
    vue: path.join(root, "node_modules", "vue", "dist"),
    marked: path.join(root, "node_modules", "marked", "lib"),
    dompurify: path.join(root, "node_modules", "dompurify", "dist"),
    mermaid: path.join(root, "node_modules", "mermaid", "dist"),
    tailwind: path.join(root, "node_modules", "@tailwindcss", "browser", "dist")
  },
  runnerScript: path.join(root, "server", "agent", "runner.js"),
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY || "",
    version: process.env.ANTHROPIC_VERSION || "2023-06-01",
    baseUrl: (process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com").replace(/\/+$/, "")
  },
  defaultModel: process.env.DEFAULT_MODEL || "claude-haiku-5-5",
  gitPath: findGit(),
  sessionDays: 30,
  maxUploadBytes: 50 * 1024 * 1024,
  maxDispatchPerTicket: 5
};

for (const dir of [config.dataDir, config.uploadDir, config.logDir, config.runDir, config.workspaceDir]) {
  mkdirSync(dir, { recursive: true });
}
