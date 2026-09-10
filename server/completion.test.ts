import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { batches, parseFile } from "./imports";
import { demoRecords, buildIndex } from "./domain";
import { detectConflicts, extendedRelationships } from "./extended-domain";

describe("completion features", () => {
  it("parses CSV through a streaming generator", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "synthetic-lab-"));
    const file = path.join(dir, "people.csv");
    await fs.writeFile(file, "tz,fname,lname,phone\n100000010,רון,כהן,050-1111111\n");
    const records = [];
    for await (const record of parseFile(file, "csv", "TEST_SOURCE")) records.push(record);
    expect(records).toHaveLength(1);
    expect(records[0]?.nationalId).toBe("100000010");
    await fs.rm(dir, { recursive: true, force: true });
  });
  it("supports resumable bounded batches", async () => {
    const batchesSeen = [];
    for await (const batch of batches((async function* () { yield* demoRecords; })(), 2, { batchNumber: 1, lastProcessedRecord: 2, sourceId: "s" })) batchesSeen.push(batch);
    expect(batchesSeen).toHaveLength(2);
    expect(batchesSeen[0]?.checkpoint.lastProcessedRecord).toBe(4);
  });
  it("detects contradictory source values", () => {
    const records = [{ ...demoRecords[0], address: "הרצל 99", externalId: "conflict" }, ...demoRecords];
    const conflicts = detectConflicts(records, buildIndex(records));
    expect(conflicts.some((c) => c.field === "address")).toBe(true);
  });
  it("derives extended relationships from deterministic edges", () => {
    const extras = extendedRelationships(buildIndex());
    expect(Array.isArray(extras)).toBe(true);
    expect(extras.every((r) => r.confidence === "VERIFIED")).toBe(true);
  });
});
