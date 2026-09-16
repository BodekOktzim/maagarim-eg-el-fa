import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { createWorkers } from "../workers/queues";
import { batches, parseFile } from "./imports";
import { PostgresRepository } from "./postgres";
import { downloadFileFromPCloud } from "./pcloud";

const repository = process.env.POSTGRES_URL ? new PostgresRepository(process.env.POSTGRES_URL) : null;
const workers = createWorkers({
  async import(job) {
    let processed = 0;
    let imported = 0;
    let errors = 0;
    let sourcePath = job.data.filePath;
    let temporaryPath: string | undefined;

    if (job.data.storage?.provider === "pcloud") {
      temporaryPath = path.join(process.env.IMPORT_TMP_DIR ?? "/tmp/synthetic-data-lab-imports", `${crypto.randomUUID()}-${job.data.storage.fileName}`);
      await fs.mkdir(path.dirname(temporaryPath), { recursive: true });
      await downloadFileFromPCloud(job.data.storage.fileId, temporaryPath);
      sourcePath = temporaryPath;
    }
    if (!sourcePath) throw new Error("Import job has no local or remote file source");

    try {
      if (repository) await repository.pool.query("INSERT INTO sources(id, name, type) VALUES($1,$2,$3) ON CONFLICT (id) DO NOTHING", [job.data.sourceId, job.data.sourceId, "UPLOAD"]);
      for await (const batch of batches(parseFile(sourcePath, job.data.format, job.data.sourceId, job.data.innerFormat), job.data.batchSize ?? 1000, { batchNumber: 0, lastProcessedRecord: 0, sourceId: job.data.sourceId })) {
        if (repository) {
          await repository.transaction(async (client) => {
            for (const record of batch.records) {
              try {
                await client.query("INSERT INTO raw_records(source_id, external_record_id, payload) VALUES($1,$2,$3) ON CONFLICT (source_id, external_record_id) DO NOTHING", [job.data.sourceId, record.externalId, record.payload]);
                imported++;
              } catch { errors++; }
            }
          });
        } else imported += batch.records.length;
        processed += batch.records.length;
        await job.updateProgress({ processed, imported, errors, checkpoint: batch.checkpoint });
      }
      return { sourceId: job.data.sourceId, processed, imported, errors, storage: job.data.storage?.provider ?? "local" };
    } finally {
      if (temporaryPath) await fs.rm(temporaryPath, { force: true });
    }
  },
  async index(job) { return { indexed: job.data.personIds.length }; },
});
for (const worker of Object.values(workers)) worker.on("failed", (job, error) => console.error("worker_failed", { jobId: job?.id, error: error.message }));
console.log("BullMQ workers ready");
