import type express from "express";

export const DEFAULT_WEB_ORIGIN = "https://bodekoktzim.github.io";

export function allowedWebOrigin(requestOrigin: string | undefined) {
  if (!requestOrigin) return "";
  const configured = process.env.WEB_APP_ALLOWED_ORIGIN || DEFAULT_WEB_ORIGIN;
  try {
    return new URL(requestOrigin).origin === new URL(configured).origin ? requestOrigin : "";
  } catch {
    return requestOrigin === configured ? requestOrigin : "";
  }
}

export function setWebCors(req: express.Request, res: express.Response) {
  const origin = allowedWebOrigin(req.headers.origin);
  if (!origin) return false;
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Range, X-Admin-Bootstrap-Secret");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Expose-Headers", "Content-Range, Accept-Ranges, Content-Length, Content-Type");
  res.setHeader("Vary", "Origin");
  return true;
}

export function setRangeResponseHeaders(res: express.Response, upstream: Headers, byteLength: number) {
  const contentRange = upstream.get("content-range");
  if (contentRange) res.setHeader("Content-Range", contentRange);
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Content-Length", String(byteLength));
}
