import { db } from "../lib/db.js";

export async function create({ token_hash, user_id, expires_at }, ex = db) {
  await ex.query("insert into sessions (token_hash, user_id, expires_at) values ($1, $2, $3)", [
    token_hash,
    user_id,
    expires_at
  ]);
}

export async function getValid(tokenHash, ex = db) {
  const res = await ex.query(
    "select token_hash, user_id, expires_at from sessions where token_hash = $1 and expires_at > now()",
    [tokenHash]
  );
  return res.rows[0] || null;
}

export async function remove(tokenHash, ex = db) {
  await ex.query("delete from sessions where token_hash = $1", [tokenHash]);
}

export async function removeByUser(userId, ex = db) {
  await ex.query("delete from sessions where user_id = $1", [userId]);
}

export async function purgeExpired(ex = db) {
  await ex.query("delete from sessions where expires_at <= now()");
}
