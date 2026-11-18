import { toId } from "../lib/util.js";
import * as ticketsService from "../services/tickets.service.js";

export async function search(req, res) {
  res.json(await ticketsService.search(toId(req.params.id), req.query, req.actor));
}

export async function detail(req, res) {
  res.json(await ticketsService.detail(toId(req.params.id), req.actor));
}

// 開票、留言後不會馬上叫 PM，PM 照排程時間檢查
export async function create(req, res) {
  res.status(201).json(await ticketsService.create(toId(req.params.id), req.body ?? {}, req.actor));
}

export async function comment(req, res) {
  res.status(201).json(await ticketsService.comment(toId(req.params.id), req.body ?? {}, req.actor));
}

export async function setStatus(req, res) {
  res.json(await ticketsService.setStatus(toId(req.params.id), req.body ?? {}, req.actor));
}
