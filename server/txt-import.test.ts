import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseFile, batches } from "./imports";

describe("TXT streaming import", () => {
  it("detects pipe delimiter and yields records incrementally", async () => {
    const file = path.join(os.tmpdir(), `synthetic-${Date.now()}.txt`);
    await fs.writeFile(file, "id|firstName|lastName\n1|Ada|Synthetic\n2|Lin|Test\n");
    const records = [];
    for await (const batch of batches(parseFile(file, "txt", "TXT_TEST"), 1)) records.push(...batch.records);
    expect(records).toHaveLength(2);
    expect(records[0]?.externalId).toBe("1");
    await fs.rm(file, { force: true });
  });
});
