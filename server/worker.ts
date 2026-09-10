import { createWorkers } from "../workers/queues";
import { batches, parseFile } from "./imports";

const workers = createWorkers({
  async import(job) {
    let processed = 0;
    for await (const batch of batches(parseFile(job.data.filePath, job.data.format, job.data.sourceId), job.data.batchSize ?? 1000)) processed += batch.records.length;
    return { sourceId: job.data.sourceId, processed };
  },
  async index(job) { return { indexed: job.data.personIds.length }; },
});

for (const worker of Object.values(workers)) worker.on("failed", (job, error) => console.error("worker_failed", { jobId: job?.id, error: error.message }));
console.log("BullMQ workers ready");
