import { toId } from "../lib/util.js";
import * as usersService from "../services/users.service.js";

export async function list(req, res) {
  res.json(await usersService.list());
}

export async function create(req, res) {
  res.status(201).json(await usersService.create(req.body ?? {}));
}

export async function update(req, res) {
  res.json(await usersService.update(toId(req.params.id), req.body ?? {}, req.actor));
}

export async function remove(req, res) {
  await usersService.remove(toId(req.params.id), req.actor);
  res.json({ ok: true });
}
