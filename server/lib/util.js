import { badRequest } from "./errors.js";

export const uniq = (list) => [...new Set(list)];

export const byId = (rows) => new Map(rows.map((row) => [row.id, row]));

// 取文字欄位：去掉前後空白、檢查必填和長度
export function text(value, { label = "欄位", max = 200, required = false } = {}) {
  const v = String(value ?? "").trim();
  if (required && !v) throw badRequest(`請填寫${label}`);
  if (v.length > max) throw badRequest(`${label}最多 ${max} 個字`);
  return v;
}

export function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function toId(value, label = "id") {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw badRequest(`${label} 格式錯誤`);
  return n;
}

export function toDate(value, label = "時間") {
  if (value === undefined || value === null || value === "") return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw badRequest(`${label}格式錯誤`);
  return d;
}

export function formatTime(value) {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  return d.toLocaleString("zh-TW", {
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

export function clip(value, max) {
  const s = String(value ?? "");
  return s.length > max ? `${s.slice(0, max)}…（截斷）` : s;
}

export function toStringList(value) {
  if (Array.isArray(value)) return uniq(value.map((v) => String(v).trim()).filter(Boolean));
  if (typeof value === "string") return uniq(value.split(",").map((v) => v.trim()).filter(Boolean));
  return [];
}
