import { createReadStream, createWriteStream } from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createGzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseFile } from "./imports";

describe("multi-format imports", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await fsp.mkdtemp(path.join(os.tmpdir(), "maagarim-import-test-"));
  });

  afterEach(async () => {
    await fsp.rm(directory, { recursive: true, force: true });
  });

  it("maps Hebrew and English delimited headers", async () => {
    const file = path.join(directory, "people.tsv");
    await fsp.writeFile(file, "תעודת זהות\tשם פרטי\tשם משפחה\tטלפון\n123\tדנה\tכהן\t050-1\n", "utf8");
    const records = [];
    for await (const record of parseFile(file, "tsv", "TEST")) records.push(record);
    expect(records[0]).toMatchObject({ nationalId: "123", firstName: "דנה", lastName: "כהן", phone: "050-1" });
  });

  it("streams JSON arrays and JSONL records", async () => {
    const json = path.join(directory, "people.json");
    const jsonl = path.join(directory, "people.ndjson");
    await fsp.writeFile(json, JSON.stringify([{ id: "a", name: "A" }, { id: "b", name: "B" }]), "utf8");
    await fsp.writeFile(jsonl, '{"id":"c","name":"C"}\n{"id":"d","name":"D"}\n', "utf8");
    const arrayRecords = [];
    const lineRecords = [];
    for await (const record of parseFile(json, "json", "JSON")) arrayRecords.push(record);
    for await (const record of parseFile(jsonl, "ndjson", "JSONL")) lineRecords.push(record);
    expect(arrayRecords.map((record) => record.externalId)).toEqual(["a", "b"]);
    expect(lineRecords.map((record) => record.externalId)).toEqual(["c", "d"]);
  });

  it("parses a gzip-delimited file using its inner format", async () => {
    const source = path.join(directory, "people.csv");
    const compressed = path.join(directory, "people.csv.gz");
    await fsp.writeFile(source, "id,firstName\na,Alpha\nb,Beta\n", "utf8");
    await pipeline(createReadStream(source), createGzip(), createWriteStream(compressed));
    const records = [];
    for await (const record of parseFile(compressed, "gzip", "GZIP", "csv")) records.push(record);
    expect(records.map((record) => record.externalId)).toEqual(["a", "b"]);
  });
});
