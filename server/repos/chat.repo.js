import { db } from "../lib/db.js";

// 最近的 limit 則訊息，舊的在前
export async function listByBoard(boardId, limit = 100, ex = db) {
  const res = await ex.query(
    "select * from (select * from chat_messages where board_id = $1 order by id desc limit $2) t order by id",
    [boardId, limit]
  );
  return res.rows;
}

export async function create({ board_id, user_id, content }, ex = db) {
  const res = await ex.query(
    "insert into chat_messages (board_id, user_id, content) values ($1, $2, $3) returning *",
    [board_id, user_id, content]
  );
  return res.rows[0];
}
