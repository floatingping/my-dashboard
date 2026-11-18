import { toId } from "../lib/util.js";
import * as agentsService from "../services/agents.service.js";

export async function listByBoard(req, res) {
  res.json(await agentsService.listRuns(toId(req.params.id), req.actor, req.query));
}

export async function get(req, res) {
  res.json(await agentsService.getRun(toId(req.params.id), req.actor));
}

export async function log(req, res) {
  const { offset, tail } = req.query;
  res.json(await agentsService.readLog(toId(req.params.id), { offset, tail }, req.actor));
}

export async function kill(req, res) {
  res.json(await agentsService.kill(toId(req.params.id), req.actor));
}

// PM 派工作 agent
export async function dispatch(req, res) {
  res.status(201).json(await agentsService.dispatchWorker(req.actor, toId(req.params.id), req.body ?? {}));
}
