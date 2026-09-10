import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024;
export const CHUNK_BYTES = 8 * 1024 * 1024;
const ROOT = process.env.UPLOAD_TMP_DIR ?? "/tmp/synthetic-data-lab-uploads";
const allowed = new Set(["csv", "json", "jsonl", "xlsx", "zip", "gz", "gzip"]);

export type UploadMeta = { id: string; fileName: string; size: number; chunkSize: number; totalChunks: number; received: number[]; createdAt: number };
function metaPath(id: string) { return path.join(ROOT, `${id}.json`); }
function filePath(id: string) { return path.join(ROOT, `${id}.partial`); }
function safeName(name: string) { return path.basename(name).replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 180) || "upload.bin"; }
function formatFromName(name: string) { const ext = name.toLowerCase().split(".").pop() ?? ""; if (ext === "gz") return "gzip"; if (!allowed.has(ext)) throw new Error("Unsupported file type"); return ext as "csv" | "json" | "jsonl" | "xlsx" | "zip" | "gzip"; }
async function load(id: string): Promise<UploadMeta> { return JSON.parse(await fs.readFile(metaPath(id), "utf8")) as UploadMeta; }
async function save(meta: UploadMeta) { await fs.writeFile(metaPath(meta.id), JSON.stringify(meta), "utf8"); }

export async function initUpload(fileName: string, size: number) {
  if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_UPLOAD_BYTES) throw new Error("File must be between 1 byte and 2GB");
  formatFromName(fileName);
  await fs.mkdir(ROOT, { recursive: true });
  const id = crypto.randomUUID();
  const meta: UploadMeta = { id, fileName: safeName(fileName), size, chunkSize: CHUNK_BYTES, totalChunks: Math.ceil(size / CHUNK_BYTES), received: [], createdAt: Date.now() };
  await save(meta);
  return meta;
}

export async function writeChunk(id: string, index: number, body: Buffer) {
  const meta = await load(id);
  if (!Number.isInteger(index) || index < 0 || index >= meta.totalChunks) throw new Error("Invalid chunk index");
  const expected = index === meta.totalChunks - 1 ? meta.size - index * meta.chunkSize : meta.chunkSize;
  if (body.length !== expected) throw new Error(`Invalid chunk size; expected ${expected} bytes`);
  const handle = await fs.open(filePath(id), "a+");
  try { await handle.write(body, 0, body.length, index * meta.chunkSize); } finally { await handle.close(); }
  if (!meta.received.includes(index)) meta.received.push(index);
  meta.received.sort((a, b) => a - b);
  await save(meta);
  return { received: meta.received.length, totalChunks: meta.totalChunks, complete: meta.received.length === meta.totalChunks };
}

export async function completeUpload(id: string) {
  const meta = await load(id);
  if (meta.received.length !== meta.totalChunks) throw new Error("Upload is incomplete");
  const stats = await fs.stat(filePath(id));
  if (stats.size !== meta.size) throw new Error("Uploaded size mismatch");
  return { ...meta, path: filePath(id), format: formatFromName(meta.fileName) };
}

export async function removeUpload(id: string) { await fs.rm(metaPath(id), { force: true }); await fs.rm(filePath(id), { force: true }); }
