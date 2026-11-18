import { toId } from "../lib/util.js";
import * as skillsService from "../services/skills.service.js";

export async function list(req, res) {
  res.json(await skillsService.list());
}

export async function create(req, res) {
  res.status(201).json(await skillsService.create(req.body ?? {}, req.actor));
}

export async function update(req, res) {
  res.json(await skillsService.update(toId(req.params.id), req.body ?? {}));
}

export async function remove(req, res) {
  await skillsService.remove(toId(req.params.id));
  res.json({ ok: true });
}
