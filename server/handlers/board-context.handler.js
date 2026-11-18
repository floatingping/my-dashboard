import { uniq } from "../lib/util.js";
import * as boardsRepo from "../repos/boards.repo.js";
import * as skillsRepo from "../repos/skills.repo.js";
import * as usersRepo from "../repos/users.repo.js";

// 看板 + PM 名字 + PM 自己的 skills + 可下放的 skills（含內容）
export async function getBoardContext(boardId) {
  const board = await boardsRepo.getById(boardId);
  if (!board) return null;
  const pm = await usersRepo.getById(board.pm_user_id);
  const skills = await skillsRepo.getByNames(uniq([...board.pm_skills, ...board.allowed_skills]));
  const byName = new Map(skills.map((s) => [s.name, s]));
  return {
    board,
    pmName: pm?.name ?? "PM",
    pmSkills: board.pm_skills.map((n) => byName.get(n)).filter(Boolean),
    allowedSkills: board.allowed_skills.map((n) => byName.get(n)).filter(Boolean)
  };
}
