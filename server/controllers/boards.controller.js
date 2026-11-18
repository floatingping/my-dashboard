import { toId } from "../lib/util.js";
import * as agentsService from "../services/agents.service.js";
import * as boardsService from "../services/boards.service.js";

export async function list(req, res) {
  const boards = await boardsService.list();
  res.json(boards.map((b) => ({ ...b, schedule: agentsService.scheduleInfo(b.id) })));
}

export async function get(req, res) {
  const id = toId(req.params.id);
  const board = await boardsService.get(id, req.actor);
  res.json({ ...board, schedule: agentsService.scheduleInfo(id) });
}

export async function create(req, res) {
  const board = await boardsService.create(req.body ?? {});
  agentsService.syncBoard(board);
  res.status(201).json(board);
}

export async function update(req, res) {
  const board = await boardsService.update(toId(req.params.id), req.body ?? {});
  agentsService.syncBoard(board);
  res.json(board);
}

export async function remove(req, res) {
  const id = toId(req.params.id);
  await boardsService.get(id, req.actor);
  await agentsService.removeBoard(id);
  await boardsService.remove(id);
  res.json({ ok: true });
}

// 「立即檢查」：不管有沒有新動態都讓 PM 跑一次
export async function runPm(req, res) {
  res.json(await agentsService.tick(toId(req.params.id), { force: true }));
}

export async function models(req, res) {
  res.json(await agentsService.listModels());
}
