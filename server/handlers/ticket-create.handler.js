import { transaction } from "../lib/db.js";
import * as boardsRepo from "../repos/boards.repo.js";
import * as commentsRepo from "../repos/comments.repo.js";
import * as ticketsRepo from "../repos/tickets.repo.js";

// 票即留言：建票 = 建一張票 + 第一則留言
// countActivity 為 true 時記錄看板動態，讓 PM 下次檢查會處理
export async function createTicketWithComment({ board_id, title, content, user_id, countActivity }) {
  return transaction(async (tx) => {
    const ticket = await ticketsRepo.create({ board_id, title, created_by: user_id }, tx);
    const comment = await commentsRepo.create({ ticket_id: ticket.id, user_id, content }, tx);
    if (countActivity) await boardsRepo.touchActivity(board_id, tx);
    return { ticket, comment };
  });
}
