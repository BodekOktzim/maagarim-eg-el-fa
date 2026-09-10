import { batches } from "../server/imports";
import type { SyntheticRecord } from "../server/domain";

const total = Number(process.env.BENCHMARK_RECORDS ?? 100_000);
const batchSize = Number(process.env.BENCHMARK_BATCH_SIZE ?? 1_000);
const template: SyntheticRecord = { source: "BENCHMARK", externalId: "", nationalId: "100000001", firstName: "Synthetic", lastName: "Person", payload: {} };
async function* records() { for (let i = 0; i < total; i++) yield { ...template, externalId: `benchmark-${i}` }; }
const started = performance.now(); let processed = 0; let batchCount = 0; for await (const batch of batches(records(), batchSize)) { processed += batch.records.length; batchCount++; }
const elapsed = performance.now() - started;
console.log(JSON.stringify({ total, processed, batches: batchCount, batchSize, elapsedMs: Math.round(elapsed), recordsPerSecond: Math.round(processed / Math.max(elapsed / 1000, 0.001)), rssMb: Math.round(process.memoryUsage().rss / 1024 / 1024) }, null, 2));
