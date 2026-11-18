import { transaction } from "../lib/db.js";
import * as commentsRepo from "../repos/comments.repo.js";
import * as ticketsRepo from "../repos/tickets.repo.js";

// 改狀態 / result，並在留言串留下一則紀錄
export async function changeTicketStatus({ ticket, status, result, user_id }) {
  const patch = {};
  const notes = [];
  if (status && status !== ticket.status) {
    patch.status = status;
    notes.push(`🔄 **狀態** \`${ticket.status}\` → \`${status}\``);
  }
  if (result !== undefined && result !== ticket.result) {
    patch.result = result;
    notes.push(`📝 **result**：${result || "（清空）"}`);
  }
  if (!notes.length) return ticket;

  return transaction(async (tx) => {
    const updated = await ticketsRepo.update(ticket.id, patch, tx);
    await commentsRepo.create({ ticket_id: ticket.id, user_id, content: notes.join("\n\n") }, tx);
    return updated;
  });
}
