import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import type { DataImportFormat, ImportFormat } from "./imports";

export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024;
export const CHUNK_BYTES = 8 * 1024 * 1024;
const ROOT = process.env.UPLOAD_TMP_DIR ?? "/tmp/synthetic-data-lab-uploads";
const supportedDataExtensionList = ["csv", "tsv", "txt", "json", "jsonl", "ndjson", "xlsx", "xls", "ods"] as const;
const supportedDataExtensions = new Set<string>(supportedDataExtensionList);
const supportedExtensions = new Set<string>([...supportedDataExtensionList, "zip", "gz", "gzip"]);

export type UploadMeta = {
  id: string;
  fileName: string;
  size: number;
  chunkSize: number;
  totalChunks: number;
  received: number[];
  createdAt: number;
  format: ImportFormat;
  innerFormat?: DataImportFormat;
};

const locks = new Map<string, Promise<void>>();
function metaPath(id: string) { return path.join(ROOT, `${id}.json`); }
function filePath(id: string) { return path.join(ROOT, `${id}.partial`); }
function safeName(name: string) { return path.basename(name).replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 180) || "upload.bin"; }

function detectFormat(name: string): { format: ImportFormat; innerFormat?: DataImportFormat } {
  const lower = name.toLowerCase();
  const extension = path.extname(lower).slice(1);
  if (extension === "gz" || extension === "gzip") {
    const innerExtension = path.extname(lower.slice(0, -extension.length - 1)).slice(1);
    return { format: "gzip", innerFormat: supportedDataExtensions.has(innerExtension) ? innerExtension as DataImportFormat : "csv" };
  }
  if (!supportedExtensions.has(extension)) throw new Error("Unsupported file type. Supported: CSV, TSV, TXT, JSON, JSONL, NDJSON, XLSX, XLS, ODS, ZIP and GZIP");
  return { format: extension === "gz" ? "gzip" : extension as ImportFormat };
}

async function load(id: string): Promise<UploadMeta> {
  return JSON.parse(await fs.readFile(metaPath(id), "utf8")) as UploadMeta;
}

async function save(meta: UploadMeta) {
  const temporary = `${metaPath(meta.id)}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(meta), "utf8");
  await fs.rename(temporary, metaPath(meta.id));
}

async function withUploadLock<T>(id: string, action: () => Promise<T>): Promise<T> {
  const previous = locks.get(id) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  const queued = previous.then(() => current);
  locks.set(id, queued);
  await previous;
  try { return await action(); } finally { release(); if (locks.get(id) === queued) locks.delete(id); }
}

export async function initUpload(fileName: string, size: number) {
  if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_UPLOAD_BYTES) throw new Error("File must be between 1 byte and 2GB");
  const detected = detectFormat(fileName);
  await fs.mkdir(ROOT, { recursive: true });
  const id = crypto.randomUUID();
  const meta: UploadMeta = { id, fileName: safeName(fileName), size, chunkSize: CHUNK_BYTES, totalChunks: Math.ceil(size / CHUNK_BYTES), received: [], createdAt: Date.now(), ...detected };
  const handle = await fs.open(filePath(id), "w");
  try { await handle.truncate(size); } finally { await handle.close(); }
  await save(meta);
  return meta;
}

export async function getUpload(id: string) {
  return load(id);
}

export async function writeChunk(id: string, index: number, body: Buffer) {
  return withUploadLock(id, async () => {
    const meta = await load(id);
    if (!Number.isInteger(index) || index < 0 || index >= meta.totalChunks) throw new Error("Invalid chunk index");
    const expected = index === meta.totalChunks - 1 ? meta.size - index * meta.chunkSize : meta.chunkSize;
    if (body.length !== expected) throw new Error(`Invalid chunk size; expected ${expected} bytes`);
    const handle = await fs.open(filePath(id), "r+");
    try { await handle.write(body, 0, body.length, index * meta.chunkSize); } finally { await handle.close(); }
    if (!meta.received.includes(index)) meta.received.push(index);
    meta.received.sort((a, b) => a - b);
    await save(meta);
    return { received: meta.received.length, totalChunks: meta.totalChunks, receivedChunks: meta.received, complete: meta.received.length === meta.totalChunks };
  });
}

export async function completeUpload(id: string) {
  const meta = await load(id);
  if (meta.received.length !== meta.totalChunks) throw new Error("Upload is incomplete");
  const stats = await fs.stat(filePath(id));
  if (stats.size !== meta.size) throw new Error("Uploaded size mismatch");
  return { ...meta, path: filePath(id) };
}

export async function removeUpload(id: string) {
  await fs.rm(metaPath(id), { force: true });
  await fs.rm(filePath(id), { force: true });
}
