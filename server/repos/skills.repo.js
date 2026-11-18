import { buildSet, db, pick, placeholders } from "../lib/db.js";

export async function list(ex = db) {
  const res = await ex.query("select * from skills order by name");
  return res.rows;
}

export async function getById(id, ex = db) {
  const res = await ex.query("select * from skills where id = $1", [id]);
  return res.rows[0] || null;
}

export async function getByName(name, ex = db) {
  const res = await ex.query("select * from skills where name = $1", [name]);
  return res.rows[0] || null;
}

export async function getByNames(names, ex = db) {
  if (!names.length) return [];
  const res = await ex.query(`select * from skills where name in (${placeholders(names.length)})`, names);
  return res.rows;
}

export async function create({ name, description, content, created_by }, ex = db) {
  const res = await ex.query(
    "insert into skills (name, description, content, created_by) values ($1, $2, $3, $4) returning *",
    [name, description, content, created_by]
  );
  return res.rows[0];
}

export async function update(id, patch, ex = db) {
  const { sets, params } = buildSet(pick(patch, ["name", "description", "content"]));
  if (!sets.length) return getById(id, ex);
  params.push(id);
  const res = await ex.query(
    `update skills set ${sets.join(", ")}, updated_at = now() where id = $${params.length} returning *`,
    params
  );
  return res.rows[0] || null;
}

export async function remove(id, ex = db) {
  await ex.query("delete from skills where id = $1", [id]);
}
