import { config } from "../lib/config.js";
import { AppError, forbidden } from "../lib/errors.js";
import { readCookie, SESSION_COOKIE } from "../middleware/auth.js";
import * as authService from "../services/auth.service.js";

const LOOPBACK = ["127.0.0.1", "::1", "::ffff:127.0.0.1"];
const MAX_FAILS = 10;
const FAIL_WINDOW_MS = 15 * 60 * 1000;
const failures = new Map(); // ip → { count, resetAt }

// 網站會透過 ngrok 公開，第一個帳號只能在伺服器本機建立
function isLocal(req) {
  return LOOPBACK.includes(req.ip);
}

function setSessionCookie(req, res, session) {
  res.cookie(SESSION_COOKIE, session.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: req.secure,
    expires: session.expiresAt,
    path: "/"
  });
}

export async function state(req, res) {
  res.json({ ...(await authService.getState(req.actor)), local: isLocal(req), port: config.port });
}

export async function setup(req, res) {
  if (!isLocal(req)) throw forbidden(`第一個帳號只能在伺服器那台電腦上建立，請開 http://localhost:${config.port}`);
  const session = await authService.setup(req.body ?? {});
  setSessionCookie(req, res, session);
  res.json({ user: session.user });
}

// 同一個 IP 失敗太多次就暫時擋下，避免有人從公開網址猜密碼
export async function login(req, res) {
  const now = Date.now();
  const record = failures.get(req.ip);
  if (record && record.resetAt > now && record.count >= MAX_FAILS) {
    throw new AppError(429, "登入失敗太多次，請 15 分鐘後再試");
  }
  try {
    const session = await authService.login(req.body ?? {});
    failures.delete(req.ip);
    setSessionCookie(req, res, session);
    res.json({ user: session.user });
  } catch (err) {
    const current = record && record.resetAt > now ? record : { count: 0, resetAt: now + FAIL_WINDOW_MS };
    current.count += 1;
    failures.set(req.ip, current);
    throw err;
  }
}

export async function logout(req, res) {
  await authService.logout(readCookie(req, SESSION_COOKIE));
  res.clearCookie(SESSION_COOKIE, { path: "/" });
  res.json({ ok: true });
}

export function me(req, res) {
  const { type, role, user, boardId = null, ticketId = null } = req.actor;
  res.json({ type, role, user, board_id: boardId, ticket_id: ticketId });
}
