import { buildSet, db, pick } from "../lib/db.js";

const PUBLIC =
  "id, board_id, ticket_id, kind, agent_user_id, model, prompt, skills, status, pid, exit_code, error, started_at, ended_at";

export async function create({ board_id, ticket_id = null, kind, agent_user_id, model, prompt, skills, token_hash }, ex = db) {
  const res = await ex.query(
    `insert into runs (board_id, ticket_id, kind, agent_user_id, model, prompt, skills, token_hash)
     values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8) returning ${PUBLIC}`,
    [board_id, ticket_id, kind, agent_user_id, model, prompt, JSON.stringify(skills || []), token_hash]
  );
  return res.rows[0];
}

export async function update(id, patch, ex = db) {
  const { sets, params } = buildSet(pick(patch, ["status", "pid", "exit_code", "error", "ended_at", "token_hash"]));
  if (!sets.length) return getById(id, ex);
  params.push(id);
  const res = await ex.query(`update runs set ${sets.join(", ")} where id = $${params.length} returning ${PUBLIC}`, params);
  return res.rows[0] || null;
}

export async function getById(id, ex = db) {
  const res = await ex.query(`select ${PUBLIC} from runs where id = $1`, [id]);
  return res.rows[0] || null;
}

export async function getRunningByTokenHash(tokenHash, ex = db) {
  const res = await ex.query(`select ${PUBLIC} from runs where token_hash = $1 and status = 'running'`, [tokenHash]);
  return res.rows[0] || null;
}

export async function listByBoard(boardId, { limit = 50 } = {}, ex = db) {
  const res = await ex.query(`select ${PUBLIC} from runs where board_id = $1 order by id desc limit $2`, [boardId, limit]);
  return res.rows;
}

export async function listByTicket(ticketId, ex = db) {
  const res = await ex.query(`select ${PUBLIC} from runs where ticket_id = $1 order by id`, [ticketId]);
  return res.rows;
}

export async function listRunning(boardId, ex = db) {
  const res = await ex.query(`select ${PUBLIC} from runs where board_id = $1 and status = 'running' order by id`, [boardId]);
  return res.rows;
}

export async function listEndedSince(boardId, since, ex = db) {
  const res = await ex.query(
    `select ${PUBLIC} from runs where board_id = $1 and kind = 'worker' and ended_at > $2 order by id`,
    [boardId, since]
  );
  return res.rows;
}

export async function countByTicket(ticketId, kind, ex = db) {
  const res = await ex.query("select count(*)::int as n from runs where ticket_id = $1 and kind = $2", [ticketId, kind]);
  return res.rows[0].n;
}

// 伺服器重新啟動時，之前沒結束的執行都當作失敗
export async function markOrphans(ex = db) {
  const res = await ex.query(
    `update runs set status = 'failed', error = '伺服器重新啟動', ended_at = now(), token_hash = null
     where status = 'running' returning id`
  );
  return res.rows;
}
