import { Router } from "express";
import * as auth from "./controllers/auth.controller.js";
import * as boards from "./controllers/boards.controller.js";
import * as chat from "./controllers/chat.controller.js";
import * as events from "./controllers/events.controller.js";
import * as files from "./controllers/files.controller.js";
import * as runs from "./controllers/runs.controller.js";
import * as skills from "./controllers/skills.controller.js";
import * as tickets from "./controllers/tickets.controller.js";
import * as users from "./controllers/users.controller.js";
import { authenticate, requireAuth, requireHuman } from "./middleware/auth.js";

export function buildRouter() {
  const r = Router();
  r.use(authenticate);

  // 不用登入
  r.get("/auth/state", auth.state);
  r.post("/auth/setup", auth.setup);
  r.post("/auth/login", auth.login);
  r.post("/auth/logout", auth.logout);

  // 以下都要登入（人或執行中的 agent）
  r.use(requireAuth);
  r.get("/me", auth.me);
  r.get("/events", requireHuman, events.stream);
  r.get("/models", requireHuman, boards.models);

  r.get("/users", requireHuman, users.list);
  r.post("/users", requireHuman, users.create);
  r.patch("/users/:id", requireHuman, users.update);
  r.delete("/users/:id", requireHuman, users.remove);

  r.get("/boards", requireHuman, boards.list);
  r.post("/boards", requireHuman, boards.create);
  r.get("/boards/:id", boards.get);
  r.patch("/boards/:id", requireHuman, boards.update);
  r.delete("/boards/:id", requireHuman, boards.remove);
  r.post("/boards/:id/run-pm", requireHuman, boards.runPm);
  r.get("/boards/:id/tickets", tickets.search);
  r.post("/boards/:id/tickets", tickets.create);
  r.post("/boards/:id/dispatch", runs.dispatch);
  r.get("/boards/:id/runs", runs.listByBoard);
  r.get("/boards/:id/chat", chat.list);
  r.post("/boards/:id/chat", chat.post);

  r.get("/tickets/:id", tickets.detail);
  r.patch("/tickets/:id", tickets.setStatus);
  r.post("/tickets/:id/comments", tickets.comment);

  r.post("/files", files.receiveFile, files.create);
  r.get("/files/:guid", files.download);
  r.get("/files/:guid/meta", files.meta);

  r.get("/skills", skills.list);
  r.post("/skills", skills.create);
  r.patch("/skills/:id", requireHuman, skills.update);
  r.delete("/skills/:id", requireHuman, skills.remove);

  r.get("/runs/:id", runs.get);
  r.get("/runs/:id/log", runs.log);
  r.post("/runs/:id/kill", runs.kill);

  return r;
}
