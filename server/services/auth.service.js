import { config } from "../lib/config.js";
import { hashPassword, newToken, sha256, verifyPassword } from "../lib/crypto.js";
import { badRequest, forbidden, unauthorized } from "../lib/errors.js";
import { text } from "../lib/util.js";
import * as runsRepo from "../repos/runs.repo.js";
import * as sessionsRepo from "../repos/sessions.repo.js";
import * as usersRepo from "../repos/users.repo.js";

function publicUser(user) {
  return user ? { id: user.id, name: user.name, is_agent: user.is_agent } : null;
}

async function openSession(user) {
  const token = newToken();
  const expiresAt = new Date(Date.now() + config.sessionDays * 24 * 60 * 60 * 1000);
  await sessionsRepo.create({ token_hash: sha256(token), user_id: user.id, expires_at: expiresAt });
  return { token, expiresAt, user: publicUser(user) };
}

export async function getState(actor) {
  const needsSetup = (await usersRepo.countHumans()) === 0;
  return { needsSetup, user: actor?.type === "human" ? actor.user : null };
}

// 第一次使用：建立第一個人類帳號
export async function setup(input) {
  if ((await usersRepo.countHumans()) > 0) throw forbidden("已經有使用者了，請直接登入");
  const name = text(input.name, { label: "名字", max: 40, required: true });
  const password = String(input.password ?? "");
  if (password.length < 6) throw badRequest("密碼至少 6 個字元");
  const user = await usersRepo.create({ name, is_agent: false, password_hash: hashPassword(password) });
  return openSession(user);
}

export async function login(input) {
  const user = await usersRepo.getActiveByName(String(input.name ?? "").trim());
  if (!user || user.is_agent || !verifyPassword(String(input.password ?? ""), user.password_hash)) {
    throw unauthorized("名字或密碼錯誤");
  }
  await sessionsRepo.purgeExpired();
  return openSession(user);
}

export async function logout(token) {
  if (token) await sessionsRepo.remove(sha256(token));
}

// 瀏覽器 cookie → 人類 actor
export async function resolveSession(token) {
  if (!token) return null;
  const session = await sessionsRepo.getValid(sha256(token));
  if (!session) return null;
  const user = await usersRepo.getById(session.user_id);
  if (!user || user.deleted_at || user.is_agent) return null;
  return { type: "human", role: "human", user: publicUser(user) };
}

// agent 執行專用 token → agent actor（只在執行期間有效）
export async function resolveRunToken(token) {
  if (!token) return null;
  const run = await runsRepo.getRunningByTokenHash(sha256(token));
  if (!run) return null;
  const user = await usersRepo.getById(run.agent_user_id);
  return {
    type: "agent",
    role: run.kind === "worker" ? "worker" : "pm",
    user: publicUser(user),
    run,
    boardId: run.board_id,
    ticketId: run.ticket_id
  };
}
