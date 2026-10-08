import type { Request, Response } from "express";
import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { hashSecret } from "./access-auth";
import { loginUser, registerUser } from "./user-auth";

function request() { return { headers: { "x-forwarded-for": "127.0.0.1", "user-agent": "test" }, socket: { remoteAddress: "127.0.0.1" } } as unknown as Request; }
function makeResponse() { const cookies: unknown[] = []; return { response: { cookie: (_name: string, _value: string, options: unknown) => cookies.push(options) }, cookies }; }

describe("user accounts", () => {
  it("rejects reserved administrator usernames", async () => {
    const pool = { query: vi.fn() } as unknown as Pool;
    await expect(registerUser(pool, request(), makeResponse().response as unknown as Response, { username: " Admin ", password: "correct-password" })).rejects.toThrow("שמור למנהל");
    expect(pool.query).not.toHaveBeenCalled();
  });

  it("rejects a duplicate username case-insensitively", async () => {
    const pool = { query: vi.fn(async (sql: string) => sql.startsWith("SELECT id FROM user_accounts") ? { rows: [{ id: "existing" }] } : { rows: [] }) } as unknown as Pool;
    await expect(registerUser(pool, request(), makeResponse().response as unknown as Response, { username: "UserName", password: "correct-password" })).rejects.toThrow("כבר קיים");
  });

  it("registers a new user without storing plaintext password", async () => {
    vi.stubEnv("ACCESS_SECRET_KEY", "test-encryption-key");
    const inserted: unknown[][] = [];
    const pool = { query: vi.fn(async (sql: string, values?: unknown[]) => {
      if (sql.startsWith("SELECT id FROM user_accounts")) return { rows: [] };
      if (sql.startsWith("SELECT email FROM admin_accounts")) return { rows: [] };
      if (sql.startsWith("INSERT INTO user_accounts")) { inserted.push(values ?? []); return { rows: [{ id: "user-1", username: "דוד" }] }; }
      return { rows: [] };
    }) } as unknown as Pool;
    const result = await registerUser(pool, request(), makeResponse().response as unknown as Response, { username: " דוד ", password: "correct-password" });
    expect(result).toEqual({ id: "user-1", username: "דוד" });
    expect(String(inserted[0][1])).toMatch(/^scrypt\$/);
    expect(inserted[0][1]).not.toBe("correct-password");
    expect(String(inserted[0][2])).toMatch(/^v1\$/);
    vi.unstubAllEnvs();
  });

  it("uses a longer cookie lifetime for Remember Me", async () => {
    const passwordHash = await hashSecret("correct-password");
    const { response: responseObject, cookies } = makeResponse();
    const pool = { query: vi.fn(async (sql: string) => {
      if (sql.startsWith("SELECT id, username")) return { rows: [{ id: "user-1", username: "דוד", password_hash: passwordHash, password_ciphertext: null, status: "active" }] };
      return { rows: [] };
    }) } as unknown as Pool;
    await loginUser(pool, request(), responseObject as unknown as Response, { username: "דוד", password: "correct-password", rememberMe: true });
    expect(cookies[0]).toMatchObject({ httpOnly: true, secure: true, sameSite: "none", maxAge: 90 * 24 * 60 * 60 * 1000 });
  });
});
