import { forbidden, unauthorized } from "../lib/errors.js";
import * as authService from "../services/auth.service.js";

export const SESSION_COOKIE = "sid";

export function readCookie(req, name) {
  for (const part of (req.headers.cookie || "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

// 人用 cookie session；agent 用執行專用的 Bearer token
export async function authenticate(req, res, next) {
  const bearer = (req.headers.authorization || "").match(/^Bearer\s+(.+)$/i)?.[1];
  req.actor = bearer
    ? await authService.resolveRunToken(bearer)
    : await authService.resolveSession(readCookie(req, SESSION_COOKIE));
  next();
}

export function requireAuth(req, res, next) {
  next(req.actor ? undefined : unauthorized());
}

export function requireHuman(req, res, next) {
  next(req.actor?.type === "human" ? undefined : forbidden("只有人類使用者可以做這件事"));
}
