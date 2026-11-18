import { db, placeholders } from "../lib/db.js";

export async function listByTicket(ticketId, ex = db) {
  const res = await ex.query("select * from comments where ticket_id = $1 order by id", [ticketId]);
  return res.rows;
}

// 多張票在某個時間之後的留言（since 為 null 時回全部）
export async function listByTicketsSince(ticketIds, since, ex = db) {
  if (!ticketIds.length) return [];
  const params = [...ticketIds];
  let sinceClause = "";
  if (since) {
    params.push(since);
    sinceClause = `and created_at > $${params.length}`;
  }
  const res = await ex.query(
    `select * from comments where ticket_id in (${placeholders(ticketIds.length)}) ${sinceClause} order by id`,
    params
  );
  return res.rows;
}

export async function create({ ticket_id, user_id, content }, ex = db) {
  const res = await ex.query(
    "insert into comments (ticket_id, user_id, content) values ($1, $2, $3) returning *",
    [ticket_id, user_id, content]
  );
  return res.rows[0];
}
