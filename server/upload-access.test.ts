import { describe, expect, it } from "vitest";
import { requireUploadAccessCode } from "./upload-access";

describe("upload access code", () => {
  it("rejects missing or wrong code", () => {
    for (const code of [undefined, "0000"]) {
      const req = { header: () => code } as never; let status = 0; let body: unknown;
      const res = { status(value: number) { status = value; return this; }, json(value: unknown) { body = value; return this; } } as never;
      requireUploadAccessCode(req, res, (() => { throw new Error("should not continue"); }) as never);
      expect(status).toBe(403); expect(body).toEqual({ error: "upload_access_code_required" });
    }
  });
  it("accepts the configured default code", () => {
    let next = false; const req = { header: () => "8568" } as never; const res = {} as never;
    requireUploadAccessCode(req, res, (() => { next = true; }) as never); expect(next).toBe(true);
  });
});
