import type { Request, Response } from "express";
import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { ACCESS_COOKIE, bootstrapAdmin, getAccessSession, hashSecret, loginWithAccessCode, verifySecret } from "./access-auth";

async function loginFixture(validityKind: "fixed" | "unlimited", validitySeconds: number | null) {
  const now = 1_800_000_000_000;
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("TURNSTILE_SECRET_KEY", "");
  vi.spyOn(Date, "now").mockReturnValue(now);
  const codeHash = await hashSecret("test-access-code");
  const calls: { sql: string; values?: unknown[] }[] = [];
  const pool = { query: vi.fn(async (sql: string, values?: unknown[]) => {
    calls.push({ sql, values });
    if (sql.startsWith("SELECT id, code_hash")) return { rows: [{ id: "code-1", code_hash: codeHash, label: null, validity_kind: validityKind, validity_seconds: validitySeconds, status: "active" }] };
    if (sql.startsWith("INSERT INTO access_sessions")) return { rows: [{ id: "session-1" }] };
    return { rows: [] };
  }) } as unknown as Pool;
  const cookies: { name: string; maxAge?: number; httpOnly?: boolean; secure?: boolean; sameSite?: string; path?: string }[] = [];
  const req = { headers: { "x-forwarded-for": "127.0.0.1", "user-agent": "unit-test" }, socket: { remoteAddress: "127.0.0.1" } } as unknown as Request;
  const res = { cookie: (name: string, _value: string, options: { maxAge?: number; httpOnly?: boolean; secure?: boolean; sameSite?: string; path?: string }) => { cookies.push({ name, maxAge: options.maxAge, httpOnly: options.httpOnly, secure: options.secure, sameSite: options.sameSite, path: options.path }); } } as unknown as Response;
  try {
    const result = await loginWithAccessCode(pool, req, res, { password: "test-access-code" });
    const insert = calls.find((call) => call.sql.startsWith("INSERT INTO access_sessions"))!;
    return { result, cookie: cookies[0], dbExpiry: insert.values?.[2] as Date, now };
  } finally {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  }
}

describe("access authentication primitives", () => {
  it("stores a salted scrypt hash and verifies only the original secret", async () => {
    const hash = await hashSecret("correct-access-code");
    expect(hash.startsWith("scrypt$")).toBe(true);
    expect(await verifySecret("correct-access-code", hash)).toBe(true);
    expect(await verifySecret("wrong-access-code", hash)).toBe(false);
  });

  it("does not reuse the same salt for repeated hashes", async () => {
    const first = await hashSecret("same-secret");
    const second = await hashSecret("same-secret");
    expect(first).not.toBe(second);
  });

  it("expires an unlimited access session after exactly 30 minutes and sets the cookie in milliseconds", async () => {
    const { result, cookie, dbExpiry, now } = await loginFixture("unlimited", null);
    expect(Date.parse(result.expiresAt!)).toBe(now + 30 * 60 * 1000);
    expect(dbExpiry.getTime()).toBe(now + 30 * 60 * 1000);
    expect(cookie.maxAge).toBe(30 * 60 * 1000);
    expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: "none", path: "/" });
  });

  it("does not let a session outlive a shorter fixed access-code validity", async () => {
    const { result, cookie, dbExpiry, now } = await loginFixture("fixed", 120);
    expect(Date.parse(result.expiresAt!)).toBe(now + 120 * 1000);
    expect(dbExpiry.getTime()).toBe(now + 120 * 1000);
    expect(cookie.maxAge).toBe(120 * 1000);
  });

  it("rejects and revokes a server-side session after its expiry", async () => {
    const now = 1_800_000_000_000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    const pool = { query: vi.fn()
      .mockResolvedValueOnce({ rows: [{ id: "session-1", access_code_id: "code-1", expires_at: new Date(now - 1), revoked_at: null, code_status: "active" }] })
      .mockResolvedValueOnce({ rows: [] }) } as unknown as Pool;
    const req = { headers: { cookie: `${ACCESS_COOKIE}=test-session-token` } } as unknown as Request;
    try {
      expect(await getAccessSession(pool, req)).toBeNull();
      expect(pool.query).toHaveBeenCalledTimes(2);
      expect(String(vi.mocked(pool.query).mock.calls[1][0])).toContain("UPDATE access_sessions SET revoked_at");
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("creates the first admin only with the configured bootstrap secret and stores a password hash", async () => {
    vi.stubEnv("ADMIN_BOOTSTRAP_SECRET", "test-bootstrap-secret");
    const inserted: unknown[][] = [];
    const pool = { query: vi.fn(async (sql: string, values?: unknown[]) => {
      if (sql.startsWith("SELECT count(*)")) return { rows: [{ count: "0" }] };
      inserted.push(values ?? []);
      return { rows: [{ id: "admin-1", email: "admin@example.com" }] };
    }) } as unknown as Pool;
    try {
      await expect(bootstrapAdmin(pool, { bootstrapSecret: "test-bootstrap-secret", email: " Admin@Example.com ", password: "a-strong-password" }))
        .resolves.toEqual({ id: "admin-1", email: "admin@example.com" });
      expect(inserted).toHaveLength(1);
      expect(inserted[0][0]).toBe("admin@example.com");
      expect(String(inserted[0][1])).toMatch(/^scrypt\$/);
      expect(inserted[0][1]).not.toBe("a-strong-password");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("refuses to bootstrap a second admin", async () => {
    vi.stubEnv("ADMIN_BOOTSTRAP_SECRET", "test-bootstrap-secret");
    const pool = { query: vi.fn(async () => ({ rows: [{ count: "1" }] })) } as unknown as Pool;
    try {
      await expect(bootstrapAdmin(pool, { bootstrapSecret: "test-bootstrap-secret", email: "admin@example.com", password: "a-strong-password" }))
        .rejects.toThrow("Admin כבר הוגדר.");
      expect(pool.query).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("rejects an incorrect bootstrap secret before querying the database", async () => {
    vi.stubEnv("ADMIN_BOOTSTRAP_SECRET", "test-bootstrap-secret");
    const pool = { query: vi.fn() } as unknown as Pool;
    try {
      await expect(bootstrapAdmin(pool, { bootstrapSecret: "wrong-secret", email: "admin@example.com", password: "a-strong-password" }))
        .rejects.toThrow("פרטי bootstrap שגויים.");
      expect(pool.query).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
