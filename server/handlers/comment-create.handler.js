import { transaction } from "../lib/db.js";
import * as boardsRepo from "../repos/boards.repo.js";
import * as commentsRepo from "../repos/comments.repo.js";
import * as ticketsRepo from "../repos/tickets.repo.js";

// 留言 + 更新票的時間；countActivity 為 true 時記錄看板動態
export async function addComment({ ticket_id, board_id, user_id, content, countActivity }) {
  return transaction(async (tx) => {
    const comment = await commentsRepo.create({ ticket_id, user_id, content }, tx);
    await ticketsRepo.touch(ticket_id, tx);
    if (countActivity) await boardsRepo.touchActivity(board_id, tx);
    return comment;
  });
}
