import { forbidden } from "./errors.js";

// 人可以看所有看板；agent 只能碰自己的看板
export function assertBoardAccess(actor, boardId) {
  if (actor.type === "agent" && actor.boardId !== boardId) throw forbidden("agent 只能存取自己的看板");
}

export function isPmOf(actor, boardId) {
  return actor.type === "agent" && actor.role === "pm" && actor.boardId === boardId;
}
