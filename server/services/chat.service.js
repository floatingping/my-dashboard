import { assertBoardAccess } from "../lib/access.js";
import { emit } from "../lib/bus.js";
import { forbidden, notFound } from "../lib/errors.js";
import { text } from "../lib/util.js";
import { getChatHistory } from "../handlers/chat-history.handler.js";
import * as boardsRepo from "../repos/boards.repo.js";
import * as chatRepo from "../repos/chat.repo.js";

async function assertBoard(boardId) {
  if (!(await boardsRepo.getById(boardId))) throw notFound("找不到看板");
}

export async function list(boardId, actor) {
  assertBoardAccess(actor, boardId);
  if (actor.role === "worker") throw forbidden("工作 agent 不能看 PM 對話");
  await assertBoard(boardId);
  return getChatHistory(boardId, 200);
}

// 人問 PM
export async function post(boardId, input, actor) {
  if (actor.type !== "human") throw forbidden("只有人可以問 PM");
  await assertBoard(boardId);
  const content = text(input.content, { label: "訊息", max: 20000, required: true });
  const message = await chatRepo.create({ board_id: boardId, user_id: actor.user.id, content });
  emit("chat", { boardId });
  return message;
}

// PM 對話執行的回覆
export async function reply(boardId, input, actor) {
  if (actor.run?.kind !== "chat" || actor.boardId !== boardId) throw forbidden("只有 PM 對話執行可以回覆");
  const content = text(input.content, { label: "回覆", max: 50000, required: true });
  const message = await chatRepo.create({ board_id: boardId, user_id: actor.user.id, content });
  emit("chat", { boardId });
  return message;
}
