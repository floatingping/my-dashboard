// 前端共用：API 呼叫、上傳、時間格式、狀態設定、SSE

export const STATUSES = [
  { key: "todo", label: "待辦", color: "bg-slate-100 text-slate-700 ring-slate-300", dot: "bg-slate-400" },
  { key: "doing", label: "進行中", color: "bg-blue-50 text-blue-700 ring-blue-200", dot: "bg-blue-500" },
  { key: "pending", label: "等待中", color: "bg-amber-50 text-amber-800 ring-amber-200", dot: "bg-amber-500" },
  { key: "done", label: "完成", color: "bg-emerald-50 text-emerald-700 ring-emerald-200", dot: "bg-emerald-500" },
  { key: "close", label: "關閉", color: "bg-zinc-100 text-zinc-500 ring-zinc-200", dot: "bg-zinc-400" }
];
export const STATUS_MAP = Object.fromEntries(STATUSES.map((s) => [s.key, s]));

export const RUN_STATUS = {
  running: { label: "執行中", color: "bg-blue-50 text-blue-700 ring-blue-200", dot: "bg-blue-500 animate-pulse" },
  succeeded: { label: "完成", color: "bg-emerald-50 text-emerald-700 ring-emerald-200", dot: "bg-emerald-500" },
  failed: { label: "失敗", color: "bg-red-50 text-red-700 ring-red-200", dot: "bg-red-500" },
  killed: { label: "已關閉", color: "bg-zinc-100 text-zinc-600 ring-zinc-200", dot: "bg-zinc-400" }
};
export const RUN_KIND = { pm: "PM 檢查", worker: "工作 agent", chat: "問 PM" };

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export function goLogin() {
  const next = encodeURIComponent(location.pathname + location.search);
  location.href = `/login?next=${next}`;
}

export async function api(path, { method = "GET", body, form } = {}) {
  const init = { method, headers: {}, credentials: "same-origin" };
  if (form) {
    init.body = form;
  } else if (body !== undefined) {
    init.headers["content-type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const res = await fetch(`/api${path}`, init);
  const type = res.headers.get("content-type") || "";
  const data = type.includes("application/json") ? await res.json() : await res.text();
  if (res.status === 401 && !path.startsWith("/auth/")) {
    goLogin();
    throw new ApiError("請先登入", 401);
  }
  if (!res.ok) throw new ApiError(data?.error || `HTTP ${res.status}`, res.status);
  return data;
}

export function uploadFile(file) {
  const form = new FormData();
  form.append("file", file, file.name || "image.png");
  return api("/files", { method: "POST", form });
}

export function query(name) {
  return new URLSearchParams(location.search).get(name);
}

export function fmtTime(value) {
  if (!value) return "";
  const d = new Date(value);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleString("zh-TW", {
    hour12: false,
    year: sameYear ? undefined : "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

export function fmtAgo(value) {
  if (!value) return "";
  const secs = (Date.now() - new Date(value).getTime()) / 1000;
  if (secs < 60) return "剛剛";
  if (secs < 3600) return `${Math.floor(secs / 60)} 分鐘前`;
  if (secs < 86400) return `${Math.floor(secs / 3600)} 小時前`;
  if (secs < 86400 * 7) return `${Math.floor(secs / 86400)} 天前`;
  return fmtTime(value);
}

export function fmtDuration(start, end) {
  if (!start) return "";
  const secs = Math.max(0, Math.round(((end ? new Date(end) : new Date()) - new Date(start)) / 1000));
  if (secs < 60) return `${secs} 秒`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} 分 ${secs % 60} 秒`;
  return `${Math.floor(mins / 60)} 小時 ${mins % 60} 分`;
}

// Date → "YYYY-MM-DD"（給 <input type="date">）
export function toDateInput(value) {
  const d = new Date(value);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function debounce(fn, ms) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

// SSE：伺服器有變動時通知頁面重新載入資料
export function onEvents(handler) {
  const source = new EventSource("/api/events");
  source.onmessage = (event) => {
    try {
      handler(JSON.parse(event.data));
    } catch (err) {
      console.error(err);
    }
  };
  return () => source.close();
}
