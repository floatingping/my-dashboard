import { EventEmitter } from "node:events";

// 伺服器內部的事件匯流排，SSE 會把事件推給前端
export const bus = new EventEmitter();
bus.setMaxListeners(0);

export function emit(type, data = {}) {
  bus.emit("event", { type, ...data, at: Date.now() });
}
