import { PGlite } from "@electric-sql/pglite";
import { config } from "./config.js";

export const db = new PGlite(config.pgDir);

const schema = `
create table if not exists users (
  id serial primary key,
  name text not null,
  is_agent boolean not null default false,
  password_hash text,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists users_name_uq on users (lower(name)) where deleted_at is null;

create table if not exists sessions (
  token_hash text primary key,
  user_id integer not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table if not exists boards (
  id serial primary key,
  title text not null,
  description text not null default '',
  folder text not null,
  pm_user_id integer not null references users(id),
  pm_prompt text not null default '',
  pm_skills jsonb not null default '[]',
  allowed_skills jsonb not null default '[]',
  cron text not null default '*/5 * * * *',
  pm_model text not null default '',
  worker_model text not null default '',
  max_workers integer not null default 1,
  max_turns integer not null default 40,
  enabled boolean not null default true,
  last_activity_at timestamptz,
  last_pm_check_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists tickets (
  id serial primary key,
  board_id integer not null references boards(id) on delete cascade,
  title text not null,
  status text not null default 'todo' check (status in ('todo', 'doing', 'done', 'close', 'pending')),
  result text not null default '',
  created_by integer not null references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tickets_board_created on tickets (board_id, created_at desc);
create index if not exists tickets_board_updated on tickets (board_id, updated_at desc);
create index if not exists tickets_board_status on tickets (board_id, status);

create table if not exists comments (
  id serial primary key,
  ticket_id integer not null references tickets(id) on delete cascade,
  user_id integer not null references users(id),
  content text not null,
  created_at timestamptz not null default now()
);
create index if not exists comments_ticket on comments (ticket_id, id);

create table if not exists files (
  guid uuid primary key,
  original_name text not null,
  mime text not null default 'application/octet-stream',
  size integer not null default 0,
  uploaded_by integer references users(id),
  created_at timestamptz not null default now()
);

create table if not exists skills (
  id serial primary key,
  name text not null unique,
  description text not null default '',
  content text not null default '',
  created_by integer references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists runs (
  id serial primary key,
  board_id integer not null references boards(id) on delete cascade,
  ticket_id integer references tickets(id) on delete set null,
  kind text not null check (kind in ('pm', 'worker', 'chat')),
  agent_user_id integer not null references users(id),
  model text not null default '',
  prompt text not null default '',
  skills jsonb not null default '[]',
  status text not null default 'running' check (status in ('running', 'succeeded', 'failed', 'killed')),
  pid integer,
  token_hash text,
  exit_code integer,
  error text,
  started_at timestamptz not null default now(),
  ended_at timestamptz
);
create index if not exists runs_board on runs (board_id, id desc);
create index if not exists runs_ticket on runs (ticket_id);
create index if not exists runs_token on runs (token_hash);

create table if not exists chat_messages (
  id serial primary key,
  board_id integer not null references boards(id) on delete cascade,
  user_id integer not null references users(id),
  content text not null,
  created_at timestamptz not null default now()
);
create index if not exists chat_board on chat_messages (board_id, id);

-- 多個 agent 同時改同一個資料夾，PM commit 時會混在一起，所以預設一次一個
alter table boards alter column max_workers set default 1;
`;

export async function migrate() {
  await db.waitReady;
  await db.exec(schema);
}

export function transaction(fn) {
  return db.transaction(fn);
}

// 組 "$1, $2, ..." 佔位符，給 in (...) 查詢用
export function placeholders(count, start = 1) {
  return Array.from({ length: count }, (_, i) => `$${i + start}`).join(", ");
}

// 把 { 欄位: 值 } 轉成 update 用的 "欄位 = $n"，值是 undefined 的欄位會略過
// 欄位名稱只能來自程式碼裡的白名單，不能直接用使用者輸入
export function buildSet(patch, { json = [] } = {}) {
  const sets = [];
  const params = [];
  for (const [column, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const isJson = json.includes(column);
    params.push(isJson ? JSON.stringify(value) : value);
    sets.push(`${column} = $${params.length}${isJson ? "::jsonb" : ""}`);
  }
  return { sets, params };
}

// 只留下白名單裡的欄位
export function pick(data, columns) {
  const out = {};
  for (const column of columns) {
    if (data[column] !== undefined) out[column] = data[column];
  }
  return out;
}
