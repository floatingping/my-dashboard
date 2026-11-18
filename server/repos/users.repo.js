import { buildSet, db, pick, placeholders } from "../lib/db.js";

const COLUMNS = "id, name, is_agent, deleted_at, created_at, updated_at";

export async function list({ includeDeleted = false } = {}, ex = db) {
  const where = includeDeleted ? "" : "where deleted_at is null";
  const res = await ex.query(`select ${COLUMNS} from users ${where} order by is_agent, lower(name)`);
  return res.rows;
}

export async function getById(id, ex = db) {
  const res = await ex.query(`select ${COLUMNS} from users where id = $1`, [id]);
  return res.rows[0] || null;
}

export async function getByIds(ids, ex = db) {
  if (!ids.length) return [];
  const res = await ex.query(`select ${COLUMNS} from users where id in (${placeholders(ids.length)})`, ids);
  return res.rows;
}

// 登入時要比對密碼，所以這裡會帶 password_hash
export async function getActiveByName(name, ex = db) {
  const res = await ex.query(
    `select ${COLUMNS}, password_hash from users where lower(name) = lower($1) and deleted_at is null`,
    [name]
  );
  return res.rows[0] || null;
}

export async function countHumans(ex = db) {
  const res = await ex.query("select count(*)::int as n from users where is_agent = false and deleted_at is null");
  return res.rows[0].n;
}

export async function create({ name, is_agent, password_hash = null }, ex = db) {
  const res = await ex.query(
    `insert into users (name, is_agent, password_hash) values ($1, $2, $3) returning ${COLUMNS}`,
    [name, Boolean(is_agent), password_hash]
  );
  return res.rows[0];
}

export async function update(id, patch, ex = db) {
  const { sets, params } = buildSet(pick(patch, ["name", "password_hash"]));
  if (!sets.length) return getById(id, ex);
  params.push(id);
  const res = await ex.query(
    `update users set ${sets.join(", ")}, updated_at = now() where id = $${params.length} returning ${COLUMNS}`,
    params
  );
  return res.rows[0] || null;
}

export async function softDelete(id, ex = db) {
  const res = await ex.query(
    `update users set deleted_at = now(), updated_at = now() where id = $1 and deleted_at is null returning ${COLUMNS}`,
    [id]
  );
  return res.rows[0] || null;
}
