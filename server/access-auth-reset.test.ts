import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { resetAccessStats } from "./access-auth";

describe("resetAccessStats", () => {
  it("resets the login counters and active sessions in one audited transaction", async () => {
    const calls: { sql: string; values?: unknown[] }[] = [];
    const client = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        calls.push({ sql, values });
        return sql.startsWith("UPDATE access_sessions") ? { rowCount: 2, rows: [{ id: "session-1" }, { id: "session-2" }] } : { rowCount: 1, rows: [] };
      }),
      release: vi.fn(),
    };
    const pool = { connect: vi.fn(async () => client) } as unknown as Pool;

    await expect(resetAccessStats(pool, "admin-1")).resolves.toEqual({ success: true, revokedSessions: 2 });
    expect(calls.map((call) => call.sql.split(/\s+/).slice(0, 2).join(" "))).toEqual([
      "BEGIN",
      "UPDATE access_sessions",
      "TRUNCATE TABLE",
      "INSERT INTO",
      "COMMIT",
    ]);
    expect(calls[1].sql).toContain("revoked_at IS NULL");
    expect(calls[2].sql).toContain("login_events RESTART IDENTITY");
    expect(calls[3].values).toEqual(["admin-1", { revokedSessions: 2 }]);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("rolls back and releases the connection if clearing events fails", async () => {
    const calls: string[] = [];
    const client = {
      query: vi.fn(async (sql: string) => {
        calls.push(sql);
        if (sql.startsWith("TRUNCATE")) throw new Error("database unavailable");
        return { rowCount: 1, rows: [] };
      }),
      release: vi.fn(),
    };
    const pool = { connect: vi.fn(async () => client) } as unknown as Pool;

    await expect(resetAccessStats(pool, "admin-1")).rejects.toThrow("database unavailable");
    expect(calls.at(-1)).toBe("ROLLBACK");
    expect(client.release).toHaveBeenCalledOnce();
  });
});
