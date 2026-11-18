import { emit } from "../lib/bus.js";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors.js";
import { byId, text, uniq } from "../lib/util.js";
import * as boardsRepo from "../repos/boards.repo.js";
import * as skillsRepo from "../repos/skills.repo.js";
import * as usersRepo from "../repos/users.repo.js";

const NAME_RE = /^[\p{L}\p{N}#+._-]{1,64}$/u;

function normalize(input, { partial = false } = {}) {
  const out = {};
  if (!partial || input.name !== undefined) {
    const name = text(input.name, { label: "名稱", max: 64, required: true }).replace(/\s+/g, "-");
    if (!NAME_RE.test(name)) throw badRequest("名稱只能用文字、數字和 # + . _ -");
    out.name = name;
  }
  if (!partial || input.description !== undefined) out.description = text(input.description, { label: "說明", max: 500 });
  if (!partial || input.content !== undefined) out.content = text(input.content, { label: "內容", max: 100000 });
  return out;
}

// 看板的 pm_skills / allowed_skills 存的是名稱，改名或刪除時要一起更新
async function renameInBoards(oldName, newName) {
  for (const board of await boardsRepo.list()) {
    const replace = (list) => uniq(list.flatMap((n) => (n === oldName ? (newName ? [newName] : []) : [n])));
    if (board.pm_skills.includes(oldName) || board.allowed_skills.includes(oldName)) {
      await boardsRepo.update(board.id, {
        pm_skills: replace(board.pm_skills),
        allowed_skills: replace(board.allowed_skills)
      });
      emit("board", { boardId: board.id });
    }
  }
}

export async function list() {
  const skills = await skillsRepo.list();
  const users = byId(await usersRepo.getByIds(uniq(skills.map((s) => s.created_by).filter(Boolean))));
  return skills.map((s) => ({
    ...s,
    created_by_name: users.get(s.created_by)?.name ?? "",
    created_by_agent: Boolean(users.get(s.created_by)?.is_agent)
  }));
}

// 人和 PM 都可以建立；PM 建的會自動加進它看板的可下放清單
export async function create(input, actor) {
  if (actor.role === "worker") throw forbidden("工作 agent 不能建立 skill");
  const data = normalize(input);
  if (await skillsRepo.getByName(data.name)) throw conflict(`skill「${data.name}」已經存在`);
  const skill = await skillsRepo.create({ ...data, created_by: actor.user.id });

  if (actor.role === "pm") {
    const board = await boardsRepo.getById(actor.boardId);
    if (board && !board.allowed_skills.includes(skill.name)) {
      await boardsRepo.update(board.id, { allowed_skills: [...board.allowed_skills, skill.name] });
      emit("board", { boardId: board.id });
    }
  }
  emit("skill", { skillId: skill.id });
  return skill;
}

export async function update(id, input) {
  const skill = await skillsRepo.getById(id);
  if (!skill) throw notFound("找不到 skill");
  const data = normalize(input, { partial: true });
  if (data.name && data.name !== skill.name) {
    if (await skillsRepo.getByName(data.name)) throw conflict(`skill「${data.name}」已經存在`);
  }
  const updated = await skillsRepo.update(id, data);
  if (data.name && data.name !== skill.name) await renameInBoards(skill.name, data.name);
  emit("skill", { skillId: id });
  return updated;
}

export async function remove(id) {
  const skill = await skillsRepo.getById(id);
  if (!skill) throw notFound("找不到 skill");
  await skillsRepo.remove(id);
  await renameInBoards(skill.name, null);
  emit("skill", { skillId: id });
}
