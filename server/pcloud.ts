import { createWriteStream, openAsBlob } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export type PCloudFile = { fileid: number; name: string; size: number };

type PCloudResponse = { result?: number; error?: string; metadata?: PCloudFile | PCloudFile[]; fileids?: number[]; hosts?: string[]; path?: string };

function config() {
  const token = process.env.PCLOUD_ACCESS_TOKEN;
  if (!token) throw new Error("pCloud storage is not configured: set PCLOUD_ACCESS_TOKEN");
  return {
    token,
    host: (process.env.PCLOUD_API_HOST ?? "https://eapi.pcloud.com").replace(/\/$/, ""),
    folderId: process.env.PCLOUD_FOLDER_ID ?? "0",
  };
}

function apiUrl(method: string, params: Record<string, string> = {}) {
  const { token, host } = config();
  const query = new URLSearchParams({ auth: token, ...params });
  return `${host}/${method}?${query.toString()}`;
}

async function jsonOrThrow(response: Response, operation: string) {
  const body = await response.json() as PCloudResponse;
  if (!response.ok || (body.result != null && body.result !== 0)) throw new Error(`pCloud ${operation} failed: ${body.error ?? response.statusText}`);
  return body;
}

export async function uploadFileToPCloud(filePath: string, fileName: string): Promise<PCloudFile> {
  const { folderId } = config();
  const form = new FormData();
  form.set("folderid", folderId);
  form.set("file", await openAsBlob(filePath), fileName);
  const response = await fetch(apiUrl("uploadfile"), { method: "POST", body: form });
  const body = await jsonOrThrow(response, "upload");
  const metadata = Array.isArray(body.metadata) ? body.metadata[0] : body.metadata;
  if (!metadata?.fileid) throw new Error("pCloud upload returned no file metadata");
  return metadata;
}

export async function downloadFileFromPCloud(fileId: number, destination: string) {
  const linkResponse = await fetch(apiUrl("getfilelink", { fileid: String(fileId) }));
  const link = await jsonOrThrow(linkResponse, "download-link");
  const host = link.hosts?.[0];
  if (!host || !link.path) throw new Error("pCloud download returned no file link");
  const fileResponse = await fetch(`https://${host}${link.path}`);
  if (!fileResponse.ok || !fileResponse.body) throw new Error(`pCloud file download failed: ${fileResponse.statusText}`);
  await pipeline(Readable.fromWeb(fileResponse.body as import("node:stream/web").ReadableStream), createWriteStream(destination));
}

export function isPCloudConfigured() {
  return Boolean(process.env.PCLOUD_ACCESS_TOKEN);
}
