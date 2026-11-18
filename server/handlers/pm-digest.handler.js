import { byId, uniq } from "../lib/util.js";
import * as commentsRepo from "../repos/comments.repo.js";
import * as runsRepo from "../repos/runs.repo.js";
import * as ticketsRepo from "../repos/tickets.repo.js";
import * as usersRepo from "../repos/users.repo.js";

const ACTIVE = ["todo", "doing", "pending"];

function toCounts(rows) {
  const counts = { todo: 0, doing: 0, pending: 0, done: 0, close: 0 };
  for (const row of rows) counts[row.status] = row.count;
  return counts;
}

// 看板概況：票數統計、進行中的票、執行中的 agent
export async function getBoardSummary(boardId) {
  const counts = toCounts(await ticketsRepo.countByStatus(boardId));
  const active = await ticketsRepo.search({ board_id: boardId, statuses: ACTIVE, limit: 60 });
  const running = await runsRepo.listRunning(boardId);
  const users = byId(await usersRepo.getByIds(uniq(running.map((r) => r.agent_user_id))));
  return {
    counts,
    active,
    running: running.map((r) => ({ ...r, agent_name: users.get(r.agent_user_id)?.name ?? "?" }))
  };
}

// PM 定時檢查用：概況 + 上次檢查後有變動的票（含新留言）+ 已結束的工作 agent
export async function getPmDigest(boardId, since) {
  const summary = await getBoardSummary(boardId);
  const changed = since
    ? await ticketsRepo.search({ board_id: boardId, from: since, limit: 30 })
    : await ticketsRepo.search({ board_id: boardId, statuses: ACTIVE, limit: 30 });
  const comments = await commentsRepo.listByTicketsSince(changed.map((t) => t.id), since);
  const ended = since ? await runsRepo.listEndedSince(boardId, since) : [];
  const users = byId(
    await usersRepo.getByIds(
      uniq([...changed.map((t) => t.created_by), ...comments.map((c) => c.user_id), ...ended.map((r) => r.agent_user_id)])
    )
  );
  const name = (id) => users.get(id)?.name ?? "?";

  return {
    ...summary,
    since,
    changed: changed.map((t) => ({
      ...t,
      created_by_name: name(t.created_by),
      comments: comments
        .filter((c) => c.ticket_id === t.id)
        .slice(-6)
        .map((c) => ({ ...c, user_name: name(c.user_id), is_agent: Boolean(users.get(c.user_id)?.is_agent) }))
    })),
    ended: ended.map((r) => ({ ...r, agent_name: name(r.agent_user_id) }))
  };
}
