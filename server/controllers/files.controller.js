import multer from "multer";
import { config } from "../lib/config.js";
import { uuid } from "../lib/crypto.js";
import * as filesService from "../services/files.service.js";

// 上傳的檔案直接用 guid 當檔名存
const upload = multer({
  storage: multer.diskStorage({
    destination: config.uploadDir,
    filename: (req, file, cb) => cb(null, uuid())
  }),
  limits: { fileSize: config.maxUploadBytes, files: 1 }
});

export const receiveFile = upload.single("file");

export async function create(req, res) {
  res.status(201).json(await filesService.save(req.file, req.actor));
}

export async function meta(req, res) {
  const { path: filePath, ...file } = await filesService.get(req.params.guid);
  res.json(file);
}

export async function download(req, res) {
  const file = await filesService.get(req.params.guid);
  const disposition = file.inline ? "inline" : "attachment";
  res.setHeader("Content-Type", file.mime);
  res.setHeader("Content-Disposition", `${disposition}; filename*=UTF-8''${encodeURIComponent(file.original_name)}`);
  // 上傳的 SVG / HTML 就算被直接打開也不能執行腳本
  res.setHeader("Content-Security-Policy", "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "private, max-age=86400");
  res.sendFile(file.path, (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: "檔案不存在" });
  });
}
