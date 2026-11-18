import { conflict } from "../lib/errors.js";
import * as usersRepo from "../repos/users.repo.js";

// 依名字找 agent 使用者，沒有就建立（agent 只有名字和 agent 標記）
export async function ensureAgentUser(name) {
  const existing = await usersRepo.getActiveByName(name);
  if (existing) {
    if (!existing.is_agent) throw conflict(`「${name}」已經是人類使用者的名字，請換一個 agent 名字`);
    const { password_hash, ...user } = existing;
    return user;
  }
  return usersRepo.create({ name, is_agent: true });
}
