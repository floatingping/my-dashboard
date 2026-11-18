import path from "node:path";
import { config } from "../lib/config.js";
import { badRequest, notFound } from "../lib/errors.js";
import * as filesRepo from "../repos/files.repo.js";

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MIME_BY_EXT = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".log": "text/plain",
  ".md": "text/markdown",
  ".json": "application/json",
  ".csv": "text/csv",
  ".html": "text/html",
  ".zip": "application/zip"
};

// multer 會把非 ASCII 的檔名當成 latin1，這裡轉回 UTF-8
function fixName(name) {
  if (/[^\u0000-\u00ff]/.test(name)) return name;
  const decoded = Buffer.from(name, "latin1").toString("utf8");
  return decoded.includes("\uFFFD") ? name : decoded;
}

function isImage(mime) {
  return /^image\/(png|jpeg|gif|webp|svg\+xml)$/.test(mime);
}

// 可以直接在瀏覽器顯示的類型，其他一律下載
function isInline(mime) {
  return /^(image\/|video\/|audio\/|text\/plain|application\/pdf)/.test(mime);
}

function present(record) {
  const url = `/api/files/${record.guid}`;
  const label = record.original_name.replace(/[[\]]/g, " ");
  return {
    ...record,
    url,
    is_image: isImage(record.mime),
    markdown: isImage(record.mime) ? `![${label}](${url})` : `[${label}](${url})`
  };
}

// 檔案已經由 multer 用 guid 當檔名存好，這裡記錄 guid 和原檔名
export async function save(file, actor) {
  if (!file) throw badRequest("沒有收到檔案（欄位名稱要是 file）");
  const name = fixName(file.originalname || "file").slice(0, 200);
  const ext = path.extname(name).toLowerCase();
  const mime =
    file.mimetype && file.mimetype !== "application/octet-stream"
      ? file.mimetype
      : MIME_BY_EXT[ext] || "application/octet-stream";
  const record = await filesRepo.create({
    guid: file.filename,
    original_name: name,
    mime,
    size: file.size,
    uploaded_by: actor.user.id
  });
  return present(record);
}

export async function get(guid) {
  if (!GUID_RE.test(guid)) throw notFound("找不到檔案");
  const record = await filesRepo.getByGuid(guid);
  if (!record) throw notFound("找不到檔案");
  return { ...present(record), path: path.join(config.uploadDir, record.guid), inline: isInline(record.mime) };
}
