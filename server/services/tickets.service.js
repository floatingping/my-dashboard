import { assertBoardAccess, isPmOf } from "../lib/access.js";
import { emit } from "../lib/bus.js";
import { badRequest, forbidden, notFound } from "../lib/errors.js";
import { clampInt, text, toDate, toStringList } from "../lib/util.js";
import { addComment } from "../handlers/comment-create.handler.js";
import { createTicketWithComment } from "../handlers/ticket-create.handler.js";
import { getTicketDetail, withCreatorNames } from "../handlers/ticket-detail.handler.js";
import { changeTicketStatus } from "../handlers/ticket-status.handler.js";
import * as boardsRepo from "../repos/boards.repo.js";
import * as ticketsRepo from "../repos/tickets.repo.js";

const STATUSES = ["todo", "doing", "done", "close", "pending"];

async function assertBoard(boardId) {
  const board = await boardsRepo.getById(boardId);
  if (!board) throw notFound("找不到看板");
  return board;
}

async function getTicket(ticketId) {
  const ticket = await ticketsRepo.getById(ticketId);
  if (!ticket) throw notFound("找不到票");
  return ticket;
}

// 時間區間 / 狀態 / 關鍵字查詢，只回摘要；細節要用 detail 深入看
export async function search(boardId, query, actor) {
  assertBoardAccess(actor, boardId);
  await assertBoard(boardId);
  const rows = await ticketsRepo.search({
    board_id: boardId,
    statuses: toStringList(query.status).filter((s) => STATUSES.includes(s)),
    from: toDate(query.from, "開始時間"),
    to: toDate(query.to, "結束時間"),
    field: query.field === "created" ? "created" : "updated",
    q: text(query.q, { label: "關鍵字", max: 200 }),
    keepActive: query.keep_active === "1" || query.keep_active === "true",
    limit: clampInt(query.limit, 1, 500, 200),
    offset: clampInt(query.offset, 0, 1000000, 0)
  });
  return withCreatorNames(rows);
}

export async function detail(ticketId, actor) {
  const ticket = await getTicketDetail(ticketId);
  if (!ticket) throw notFound("找不到票");
  assertBoardAccess(actor, ticket.board_id);
  return ticket;
}

// 人和 agent 都可以開票；PM 自己開的票不算新動態
export async function create(boardId, input, actor) {
  assertBoardAccess(actor, boardId);
  await assertBoard(boardId);
  const content = text(input.content, { label: "內容", max: 100000 });
  let title = text(input.title, { label: "標題", max: 200 });
  if (!title && !content) throw badRequest("請輸入標題或內容");
  if (!title) title = content.split("\n")[0].replace(/^[#>*\-\s]+/, "").slice(0, 80) || "（無標題）";

  const { ticket } = await createTicketWithComment({
    board_id: boardId,
    title,
    content: content || title,
    user_id: actor.user.id,
    countActivity: actor.role !== "pm"
  });
  emit("ticket", { boardId, ticketId: ticket.id });
  return ticket;
}

// 只有人的留言算新動態（工作 agent 的進度留言等它結束再一起看）
export async function comment(ticketId, input, actor) {
  const ticket = await getTicket(ticketId);
  assertBoardAccess(actor, ticket.board_id);
  const content = text(input.content, { label: "留言", max: 100000, required: true });
  const created = await addComment({
    ticket_id: ticketId,
    board_id: ticket.board_id,
    user_id: actor.user.id,
    content,
    countActivity: actor.role === "human"
  });
  emit("comment", { boardId: ticket.board_id, ticketId });
  return { ...created, board_id: ticket.board_id };
}

// 只有這個看板的 PM 可以改狀態和 result
export async function setStatus(ticketId, input, actor) {
  const ticket = await getTicket(ticketId);
  if (!isPmOf(actor, ticket.board_id)) throw forbidden("只有這個看板的 PM 可以改狀態和 result");
  if (input.status !== undefined && !STATUSES.includes(input.status)) {
    throw badRequest("狀態只能是 todo、doing、done、close、pending");
  }
  const result = input.result === undefined ? undefined : text(input.result, { label: "result", max: 20000 });
  const updated = await changeTicketStatus({ ticket, status: input.status, result, user_id: actor.user.id });
  emit("ticket", { boardId: ticket.board_id, ticketId });
  return updated;
}
