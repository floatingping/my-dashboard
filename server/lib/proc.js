import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";

const isWin = process.platform === "win32";

// 啟動一個 node 子行程，stdout/stderr 都寫進 log 檔
export function spawnNode(scriptPath, args, { env, cwd, logFile }) {
  const out = createWriteStream(logFile, { flags: "a" });
  const child = spawn(process.execPath, [scriptPath, ...args], {
    cwd,
    env,
    windowsHide: true,
    detached: !isWin,
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout.pipe(out, { end: false });
  child.stderr.pipe(out, { end: false });
  child.on("close", () => out.end());
  child.on("error", (err) => out.write(`\n[spawn error] ${err.message}\n`));
  return child;
}

// 執行 shell 指令（給 agent 的 run_command 用），逾時就砍整個行程樹
export function runShell(command, { cwd, timeoutMs, env }) {
  return new Promise((resolve) => {
    const full = isWin ? `chcp 65001>nul & ${command}` : command;
    const child = spawn(full, {
      cwd,
      env,
      shell: true,
      windowsHide: true,
      detached: !isWin,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    let timedOut = false;
    const collect = (chunk) => {
      output += chunk.toString("utf8");
      if (output.length > 400000) output = output.slice(-400000);
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child.pid);
    }, timeoutMs);
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: -1, output: `${output}\n${err.message}`, timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, output, timedOut });
    });
  });
}

// 不經過 shell 直接執行程式（參數不會被 shell 解讀，給 git 用）
export function runFile(file, args, { cwd, env, timeoutMs = 60000, input } = {}) {
  return new Promise((resolve) => {
    const child = spawn(file, args, { cwd, env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout.on("data", (chunk) => {
      if (stdout.length < 2000000) stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      if (stderr.length < 200000) stderr += chunk.toString("utf8");
    });
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child.pid);
    }, timeoutMs);
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: `${stderr}${err.message}`, timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input ?? "");
  });
}

// 砍掉行程和它所有的子行程
export function killTree(pid) {
  return new Promise((resolve) => {
    if (!pid) return resolve(false);
    if (isWin) {
      const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true });
      killer.on("exit", (code) => resolve(code === 0));
      killer.on("error", () => resolve(false));
      return;
    }
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        return resolve(false);
      }
    }
    resolve(true);
  });
}
