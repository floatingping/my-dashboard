import { db } from "../lib/db.js";

export async function create({ guid, original_name, mime, size, uploaded_by }, ex = db) {
  const res = await ex.query(
    "insert into files (guid, original_name, mime, size, uploaded_by) values ($1, $2, $3, $4, $5) returning *",
    [guid, original_name, mime, size, uploaded_by]
  );
  return res.rows[0];
}

export async function getByGuid(guid, ex = db) {
  const res = await ex.query("select * from files where guid = $1", [guid]);
  return res.rows[0] || null;
}
