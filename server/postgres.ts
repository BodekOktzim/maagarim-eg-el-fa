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
  async close() { await this.pool.end(); }
}
