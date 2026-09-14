import type { NextFunction, Request, Response } from "express";

const configuredCode = () => process.env.UPLOAD_ACCESS_CODE ?? "8568";
export function requireUploadAccessCode(req: Request, res: Response, next: NextFunction) {
  const provided = req.header("x-upload-code") ?? (typeof req.body?.accessCode === "string" ? req.body.accessCode : "");
  if (!provided || provided !== configuredCode()) { res.status(403).json({ error: "upload_access_code_required" }); return; }
  next();
}
