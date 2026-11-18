import { buildSet, db, pick, placeholders } from "../lib/db.js";

const SUMMARY = "id, board_id, title, status, result, created_by, created_at, updated_at";

// 依時間區間 / 狀態 / 關鍵字查票，只回摘要欄位
export async function search(
  { board_id, statuses = [], from, to, field = "updated", q, keepActive = false, limit = 200, offset = 0 },
  ex = db
) {
  const where = ["board_id = $1"];
  const params = [board_id];
  const column = field === "created" ? "created_at" : "updated_at";

  if (statuses.length) {
    where.push(`status in (${placeholders(statuses.length, params.length + 1)})`);
    params.push(...statuses);
  }

  const range = [];
  if (from) {
    params.push(from);
    range.push(`${column} >= $${params.length}`);
  }
  if (to) {
    params.push(to);
    range.push(`${column} <= $${params.length}`);
  }
  if (range.length) {
    const condition = range.join(" and ");
    // keepActive：進行中的票不受時間區間限制
    where.push(keepActive ? `(${condition} or status in ('todo', 'doing', 'pending'))` : condition);
  }

  if (q) {
    params.push(`%${q}%`);
    const like = `$${params.length}`;
    const idMatch = q.match(/^#?(\d+)$/);
    if (idMatch) {
      params.push(Number(idMatch[1]));
      where.push(`(title ilike ${like} or result ilike ${like} or id = $${params.length})`);
    } else {
      where.push(`(title ilike ${like} or result ilike ${like})`);
    }
  }

  params.push(limit, offset);
  const res = await ex.query(
    `select ${SUMMARY} from tickets where ${where.join(" and ")}
     order by ${column} desc, id desc limit $${params.length - 1} offset $${params.length}`,
    params
  );
  return res.rows;
}

export async function getById(id, ex = db) {
  const res = await ex.query(`select ${SUMMARY} from tickets where id = $1`, [id]);
  return res.rows[0] || null;
}

export async function create({ board_id, title, created_by }, ex = db) {
  const res = await ex.query(
    `insert into tickets (board_id, title, created_by) values ($1, $2, $3) returning ${SUMMARY}`,
    [board_id, title, created_by]
  );
  return res.rows[0];
}

export async function update(id, patch, ex = db) {
  const { sets, params } = buildSet(pick(patch, ["status", "result"]));
  if (!sets.length) return getById(id, ex);
  params.push(id);
  const res = await ex.query(
    `update tickets set ${sets.join(", ")}, updated_at = now() where id = $${params.length} returning ${SUMMARY}`,
    params
  );
  return res.rows[0] || null;
}

export async function touch(id, ex = db) {
  await ex.query("update tickets set updated_at = now() where id = $1", [id]);
}

export async function countByStatus(boardId, ex = db) {
  const res = await ex.query(
    "select status, count(*)::int as count from tickets where board_id = $1 group by status",
    [boardId]
  );
  return res.rows;
}
