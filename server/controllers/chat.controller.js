import { toId } from "../lib/util.js";
import * as agentsService from "../services/agents.service.js";
import * as chatService from "../services/chat.service.js";

export async function list(req, res) {
  res.json(await chatService.list(toId(req.params.id), req.actor));
}

// 人發問 → 存訊息並啟動 PM 對話執行；PM 對話執行送回覆 → 存回覆
export async function post(req, res) {
  const boardId = toId(req.params.id);
  if (req.actor.type === "agent") {
    res.status(201).json(await chatService.reply(boardId, req.body ?? {}, req.actor));
    return;
  }
  const message = await chatService.post(boardId, req.body ?? {}, req.actor);
  agentsService.startChat(boardId).catch((err) => console.error("[chat]", err));
  res.status(201).json(message);
}
