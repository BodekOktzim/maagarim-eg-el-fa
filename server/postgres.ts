import { Pool, type PoolClient } from "pg";
import fs from "node:fs/promises";
import path from "node:path";

export class PostgresRepository {
  readonly pool: Pool;
  constructor(connectionString = process.env.POSTGRES_URL ?? process.env.DATABASE_URL) {
    if (!connectionString) throw new Error("POSTGRES_URL or DATABASE_URL is required");
    this.pool = new Pool({ connectionString, max: Number(process.env.PG_POOL_SIZE ?? 10), statement_timeout: 30000 });
  }
  async migrate() { const sql = await fs.readFile(path.join(process.cwd(), "migrations/001_initial.sql"), "utf8"); await this.pool.query(sql); }
  async transaction<T>(fn: (client: PoolClient) => Promise<T>) { const client = await this.pool.connect(); try { await client.query("BEGIN"); const result = await fn(client); await client.query("COMMIT"); return result; } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); } }
  async audit(input: { userId?: string; action: string; queryType?: string; queryValue?: string; metadata?: unknown }) { await this.pool.query("INSERT INTO audit_logs(user_id, action, query_type, query_value, metadata) VALUES($1,$2,$3,$4,$5)", [input.userId ?? null, input.action, input.queryType ?? null, input.queryValue ?? null, input.metadata ?? {}]); }
  async searchRaw(query: string, type: "national_id" | "phone" | "name" | "address" | "name_address", page = 1, pageSize = 20) {
    const value = `%${query}%`; const conditions: Record<string, string> = { national_id: "payload->>'nationalId' ILIKE $1 OR payload->>'tz' ILIKE $1", phone: "payload->>'phone' ILIKE $1", name: "concat_ws(' ', payload->>'firstName', payload->>'lastName', payload->>'fname', payload->>'lname') ILIKE $1", address: "payload->>'address' ILIKE $1", name_address: "(concat_ws(' ', payload->>'firstName', payload->>'lastName', payload->>'fname', payload->>'lname') ILIKE $1 OR payload->>'address' ILIKE $1)" };
    const where = conditions[type]; const offset = (page - 1) * pageSize; const count = await this.pool.query(`SELECT count(*)::int AS total FROM raw_records WHERE ${where}`, [value]); const rows = await this.pool.query(`SELECT id::text, external_record_id, payload, source_id::text FROM raw_records WHERE ${where} ORDER BY id LIMIT $2 OFFSET $3`, [value, pageSize, offset]);
    return { total: count.rows[0]?.total ?? 0, page, pageSize, items: rows.rows.map((row) => ({ id: row.id, fullName: [row.payload.firstName ?? row.payload.fname, row.payload.lastName ?? row.payload.lname].filter(Boolean).join(" ") || row.external_record_id, nationalId: row.payload.nationalId ?? row.payload.tz, phone: row.payload.phone, address: row.payload.address, sourceNames: [row.source_id], rawRecordId: row.id })) };
  }
  async sourceCounts() { const result = await this.pool.query("SELECT source_id::text AS name, count(*)::int AS records FROM raw_records GROUP BY source_id ORDER BY source_id"); return result.rows as Array<{ name: string; records: number }>; }
  async close() { await this.pool.end(); }
}
