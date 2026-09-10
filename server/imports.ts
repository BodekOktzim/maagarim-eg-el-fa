import fs from "node:fs";
import fsp from "node:fs/promises";
import { createGunzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { parse } from "csv-parse";
import * as XLSX from "xlsx";
import unzipper from "unzipper";
import type { SyntheticRecord } from "./domain";

export type ImportCheckpoint = { batchNumber: number; lastProcessedRecord: number; sourceId: string };
export type ImportFormat = "csv" | "json" | "jsonl" | "xlsx" | "zip" | "gzip";

const mapRecord = (row: Record<string, unknown>, source: string, index: number): SyntheticRecord => ({
  source,
  externalId: String(row.externalId ?? row.id ?? row.tz ?? `${source}-${index}`),
  nationalId: row.nationalId == null ? (row.tz == null ? undefined : String(row.tz)) : String(row.nationalId),
  firstName: row.firstName == null ? (row.fname == null ? undefined : String(row.fname)) : String(row.firstName),
  lastName: row.lastName == null ? (row.lname == null ? undefined : String(row.lname)) : String(row.lastName),
  phone: row.phone == null ? undefined : String(row.phone),
  address: row.address == null ? undefined : String(row.address),
  birthDate: row.birthDate == null ? undefined : String(row.birthDate),
  fatherNationalId: row.fatherNationalId == null ? (row.father_tz == null ? undefined : String(row.father_tz)) : String(row.fatherNationalId),
  motherNationalId: row.motherNationalId == null ? (row.mother_tz == null ? undefined : String(row.mother_tz)) : String(row.motherNationalId),
  payload: row,
});

export async function* parseDelimited(file: string, source: string, delimiter = ","): AsyncGenerator<SyntheticRecord> {
  let index = 0;
  const parser = fs.createReadStream(file).pipe(parse({ columns: true, bom: true, delimiter, relax_column_count: true }));
  for await (const row of parser) yield mapRecord(row as Record<string, unknown>, source, index++);
}

export async function* parseJsonl(file: string, source: string): AsyncGenerator<SyntheticRecord> {
  const input = fs.createReadStream(file, "utf8");
  let remainder = "";
  let index = 0;
  for await (const chunk of input) {
    remainder += chunk;
    const lines = remainder.split(/\r?\n/);
    remainder = lines.pop() ?? "";
    for (const line of lines) if (line.trim()) yield mapRecord(JSON.parse(line) as Record<string, unknown>, source, index++);
  }
  if (remainder.trim()) yield mapRecord(JSON.parse(remainder) as Record<string, unknown>, source, index++);
}

export async function* parseJson(file: string, source: string): AsyncGenerator<SyntheticRecord> {
  const data = JSON.parse(await fsp.readFile(file, "utf8")) as Record<string, unknown>[];
  for (let i = 0; i < data.length; i++) yield mapRecord(data[i], source, i);
}

export async function* parseXlsx(file: string, source: string): AsyncGenerator<SyntheticRecord> {
  const workbook = XLSX.readFile(file, { cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) return;
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);
  for (let i = 0; i < rows.length; i++) yield mapRecord(rows[i], source, i);
}

export async function* parseFile(file: string, format: ImportFormat, source: string): AsyncGenerator<SyntheticRecord> {
  if (format === "csv") { yield* parseDelimited(file, source); return; }
  if (format === "jsonl") { yield* parseJsonl(file, source); return; }
  if (format === "json") { yield* parseJson(file, source); return; }
  if (format === "xlsx") { yield* parseXlsx(file, source); return; }
  if (format === "gzip") {
    const temp = `${file}.decompressed`;
    await pipeline(fs.createReadStream(file), createGunzip(), fs.createWriteStream(temp));
    yield* parseDelimited(temp, source);
    await fsp.rm(temp, { force: true });
    return;
  }
  if (format === "zip") {
    const directory = await unzipper.Open.file(file);
    const entry = directory.files.find((item) => /\.(csv|jsonl|json)$/i.test(item.path));
    if (!entry) throw new Error("ZIP must contain CSV, JSONL or JSON");
    const contents = await entry.buffer();
    const temp = `${file}.${entry.path.replace(/[^a-z0-9.]/gi, "_")}`;
    await fsp.writeFile(temp, contents);
    const nested: ImportFormat = /\.jsonl$/i.test(entry.path) ? "jsonl" : /\.json$/i.test(entry.path) ? "json" : "csv";
    yield* parseFile(temp, nested, source);
    await fsp.rm(temp, { force: true });
    return;
  }
  throw new Error(`Unsupported import format: ${format}`);
}

export async function* batches(records: AsyncIterable<SyntheticRecord>, batchSize = 1000, checkpoint?: ImportCheckpoint) {
  let batch: SyntheticRecord[] = [];
  let position = 0;
  for await (const record of records) {
    position++;
    if (checkpoint && position <= checkpoint.lastProcessedRecord) continue;
    batch.push(record);
    if (batch.length >= batchSize) {
      yield { records: batch, checkpoint: { batchNumber: Math.ceil(position / batchSize), lastProcessedRecord: position, sourceId: checkpoint?.sourceId ?? "" } };
      batch = [];
    }
  }
  if (batch.length) yield { records: batch, checkpoint: { batchNumber: Math.ceil(position / batchSize), lastProcessedRecord: position, sourceId: checkpoint?.sourceId ?? "" } };
}
