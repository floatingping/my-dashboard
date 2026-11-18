import { byId, uniq } from "../lib/util.js";
import * as chatRepo from "../repos/chat.repo.js";
import * as usersRepo from "../repos/users.repo.js";

// 「問 PM」的對話紀錄（含發話者名字）
export async function getChatHistory(boardId, limit = 100) {
  const messages = await chatRepo.listByBoard(boardId, limit);
  const users = byId(await usersRepo.getByIds(uniq(messages.map((m) => m.user_id))));
  return messages.map((m) => ({
    ...m,
    user_name: users.get(m.user_id)?.name ?? "?",
    is_agent: Boolean(users.get(m.user_id)?.is_agent)
  }));
}
