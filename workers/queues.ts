import { Queue, Worker, type Job } from "bullmq";
import IORedis from "ioredis";

export type ImportJob = { sourceId: string; filePath: string; format: "csv" | "json" | "jsonl" | "xlsx" | "zip" | "gzip"; batchSize?: number };
export type IndexJob = { personIds: string[] };
let sharedConnection: IORedis | undefined;
let sharedQueues: ReturnType<typeof createQueues> | undefined;

export function createRedisConnection() { const url = process.env.REDIS_URL ?? "redis://127.0.0.1:6379"; return new IORedis(url, { maxRetriesPerRequest: null, lazyConnect: true }); }
export function createQueues(connection = createRedisConnection()) { return { imports: new Queue<ImportJob>("imports", { connection }), indexing: new Queue<IndexJob>("indexing", { connection }) }; }
export function getQueues() { sharedConnection ??= createRedisConnection(); sharedQueues ??= createQueues(sharedConnection); return sharedQueues; }
export async function enqueueImport(data: ImportJob) { const { imports } = getQueues(); return imports.add("parse-and-import", data, { removeOnComplete: false, removeOnFail: false, attempts: 3, backoff: { type: "exponential", delay: 5000 } }); }
export async function importJobStatus(id: string) { const { imports } = getQueues(); const job = await imports.getJob(id); if (!job) return null; return { id: job.id, state: await job.getState(), progress: job.progress, returnvalue: job.returnvalue, failedReason: job.failedReason, data: job.data }; }
export function createWorkers(handlers: { import: (job: Job<ImportJob>) => Promise<unknown>; index: (job: Job<IndexJob>) => Promise<unknown> }, connection = createRedisConnection()) { const importWorker = new Worker<ImportJob>("imports", handlers.import, { connection, concurrency: Number(process.env.IMPORT_CONCURRENCY ?? 1) }); const indexingWorker = new Worker<IndexJob>("indexing", handlers.index, { connection, concurrency: Number(process.env.INDEX_CONCURRENCY ?? 2) }); return { importWorker, indexingWorker }; }
