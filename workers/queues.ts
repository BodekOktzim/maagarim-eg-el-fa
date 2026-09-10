import { Queue, Worker, type Job } from "bullmq";
import IORedis from "ioredis";

export type ImportJob = { sourceId: string; filePath: string; format: "csv" | "json" | "jsonl" | "xlsx" | "zip" | "gzip"; batchSize?: number };
export type IndexJob = { personIds: string[] };

export function createRedisConnection() {
  const url = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
  return new IORedis(url, { maxRetriesPerRequest: null, lazyConnect: true });
}

export function createQueues(connection = createRedisConnection()) {
  return { imports: new Queue<ImportJob>("imports", { connection }), indexing: new Queue<IndexJob>("indexing", { connection }) };
}

export function createWorkers(handlers: { import: (job: Job<ImportJob>) => Promise<unknown>; index: (job: Job<IndexJob>) => Promise<unknown> }, connection = createRedisConnection()) {
  const importWorker = new Worker<ImportJob>("imports", handlers.import, { connection, concurrency: Number(process.env.IMPORT_CONCURRENCY ?? 1) });
  const indexingWorker = new Worker<IndexJob>("indexing", handlers.index, { connection, concurrency: Number(process.env.INDEX_CONCURRENCY ?? 2) });
  return { importWorker, indexingWorker };
}
