import { byId, uniq } from "../lib/util.js";
import * as commentsRepo from "../repos/comments.repo.js";
import * as runsRepo from "../repos/runs.repo.js";
import * as ticketsRepo from "../repos/tickets.repo.js";
import * as usersRepo from "../repos/users.repo.js";

// 票的完整內容：票 + 留言串（含作者）+ 這張票的 agent 執行紀錄
export async function getTicketDetail(ticketId) {
  const ticket = await ticketsRepo.getById(ticketId);
  if (!ticket) return null;
  const comments = await commentsRepo.listByTicket(ticketId);
  const runs = await runsRepo.listByTicket(ticketId);
  const users = byId(
    await usersRepo.getByIds(
      uniq([ticket.created_by, ...comments.map((c) => c.user_id), ...runs.map((r) => r.agent_user_id)])
    )
  );
  return {
    ...ticket,
    created_by_name: users.get(ticket.created_by)?.name ?? "?",
    comments: comments.map((c) => ({
      ...c,
      user_name: users.get(c.user_id)?.name ?? "?",
      is_agent: Boolean(users.get(c.user_id)?.is_agent)
    })),
    runs: runs.map((r) => ({ ...r, agent_name: users.get(r.agent_user_id)?.name ?? "?" }))
  };
}

// 票摘要清單補上建立者名字
export async function withCreatorNames(tickets) {
  const users = byId(await usersRepo.getByIds(uniq(tickets.map((t) => t.created_by))));
  return tickets.map((t) => ({
    ...t,
    created_by_name: users.get(t.created_by)?.name ?? "?",
    created_by_agent: Boolean(users.get(t.created_by)?.is_agent)
  }));
}
