import { buildSet, db, pick } from "../lib/db.js";

const JSON_COLUMNS = ["pm_skills", "allowed_skills"];
const EDITABLE = [
  "title",
  "description",
  "folder",
  "pm_user_id",
  "pm_prompt",
  "pm_skills",
  "allowed_skills",
  "cron",
  "pm_model",
  "worker_model",
  "max_workers",
  "max_turns",
  "enabled"
];

export async function list(ex = db) {
  const res = await ex.query("select * from boards order by id");
  return res.rows;
}

export async function getById(id, ex = db) {
  const res = await ex.query("select * from boards where id = $1", [id]);
  return res.rows[0] || null;
}

export async function create(data, ex = db) {
  const fields = pick(data, EDITABLE);
  const columns = Object.keys(fields);
  const params = columns.map((c) => (JSON_COLUMNS.includes(c) ? JSON.stringify(fields[c]) : fields[c]));
  const values = columns.map((c, i) => `$${i + 1}${JSON_COLUMNS.includes(c) ? "::jsonb" : ""}`);
  const res = await ex.query(
    `insert into boards (${columns.join(", ")}) values (${values.join(", ")}) returning *`,
    params
  );
  return res.rows[0];
}

export async function update(id, patch, ex = db) {
  const { sets, params } = buildSet(pick(patch, EDITABLE), { json: JSON_COLUMNS });
  if (!sets.length) return getById(id, ex);
  params.push(id);
  const res = await ex.query(
    `update boards set ${sets.join(", ")}, updated_at = now() where id = $${params.length} returning *`,
    params
  );
  return res.rows[0] || null;
}

export async function remove(id, ex = db) {
  await ex.query("delete from boards where id = $1", [id]);
}

export async function touchActivity(id, ex = db) {
  await ex.query("update boards set last_activity_at = now() where id = $1", [id]);
}

export async function setPmCheck(id, at, ex = db) {
  await ex.query("update boards set last_pm_check_at = $2 where id = $1", [id, at]);
}
