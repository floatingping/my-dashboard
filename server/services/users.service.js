import { emit } from "../lib/bus.js";
import { hashPassword } from "../lib/crypto.js";
import { badRequest, conflict, notFound } from "../lib/errors.js";
import { text } from "../lib/util.js";
import * as boardsRepo from "../repos/boards.repo.js";
import * as sessionsRepo from "../repos/sessions.repo.js";
import * as usersRepo from "../repos/users.repo.js";

function checkPassword(password) {
  const value = String(password ?? "");
  if (value.length < 6) throw badRequest("密碼至少 6 個字元");
  return value;
}

async function assertNameFree(name, exceptId = null) {
  const other = await usersRepo.getActiveByName(name);
  if (other && other.id !== exceptId) throw conflict(`「${name}」這個名字已經有人用了`);
}

export async function list() {
  return usersRepo.list();
}

// 人：名字 + 密碼；agent：只有名字和 agent 標記
export async function create(input) {
  const name = text(input.name, { label: "名字", max: 40, required: true });
  await assertNameFree(name);
  const user = input.is_agent
    ? await usersRepo.create({ name, is_agent: true })
    : await usersRepo.create({ name, is_agent: false, password_hash: hashPassword(checkPassword(input.password)) });
  emit("user", { userId: user.id });
  return user;
}

export async function update(id, input, actor) {
  const user = await usersRepo.getById(id);
  if (!user || user.deleted_at) throw notFound("找不到使用者");
  const patch = {};
  if (input.name !== undefined) {
    patch.name = text(input.name, { label: "名字", max: 40, required: true });
    await assertNameFree(patch.name, id);
  }
  if (input.password) {
    if (user.is_agent) throw badRequest("agent 沒有密碼");
    patch.password_hash = hashPassword(checkPassword(input.password));
  }
  const updated = await usersRepo.update(id, patch);
  // 改了別人的密碼就讓他重新登入
  if (patch.password_hash && id !== actor.user.id) await sessionsRepo.removeByUser(id);
  emit("user", { userId: id });
  return updated;
}

// 軟刪除：舊留言上的名字還會保留
export async function remove(id, actor) {
  if (id === actor.user.id) throw badRequest("不能刪除自己");
  const user = await usersRepo.getById(id);
  if (!user || user.deleted_at) throw notFound("找不到使用者");
  if (!user.is_agent && (await usersRepo.countHumans()) <= 1) throw badRequest("至少要保留一個人類使用者");
  const boards = await boardsRepo.list();
  const pmOf = boards.filter((b) => b.pm_user_id === id);
  if (pmOf.length) {
    throw badRequest(`這個 agent 是看板「${pmOf.map((b) => b.title).join("、")}」的 PM，請先在看板設定換掉`);
  }
  await usersRepo.softDelete(id);
  await sessionsRepo.removeByUser(id);
  emit("user", { userId: id });
}
