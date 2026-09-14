import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { createGunzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { parse } from "csv-parse";
import * as XLSX from "xlsx";
import unzipper from "unzipper";
import type { SyntheticRecord } from "./domain";

export type ImportFormat =
  | "csv"
  | "tsv"
  | "txt"
  | "json"
  | "jsonl"
  | "ndjson"
  | "xlsx"
  | "xls"
  | "ods"
  | "zip"
  | "gzip";
export type DataImportFormat = Exclude<ImportFormat, "zip" | "gzip">;
export type ImportCheckpoint = { batchNumber: number; lastProcessedRecord: number; sourceId: string };

const normalizedKey = (key: string) => key.toLowerCase().replace(/[\s_\-./\\:()\[\]{}]+/g, "").trim();
const aliases: Record<string, string[]> = {
  externalId: ["externalId", "external_id", "id", "recordId", "מספררשומה", "מזהה"],
  nationalId: ["nationalId", "national_id", "tz", "teudatZehut", "תז", "תעודתזהות", "מספרזהות", "מסזהות"],
  firstName: ["firstName", "fname", "givenName", "name", "שם", "שםפרטי"],
  lastName: ["lastName", "lname", "familyName", "surname", "שםמשפחה"],
  phone: ["phone", "telephone", "mobile", "cell", "טלפון", "נייד", "טלפוןנייד"],
  address: ["address", "streetAddress", "כתובת", "מען"],
  birthDate: ["birthDate", "dateOfBirth", "dob", "תאריךלידה"],
  fatherNationalId: ["fatherNationalId", "father_tz", "fatherId", "אב", "תזאב", "מסזהותאב"],
  motherNationalId: ["motherNationalId", "mother_tz", "motherId", "אם", "תזאם", "מסזהותאם"],
};

function valueFor(row: Record<string, unknown>, field: string) {
  const wanted = new Set((aliases[field] ?? [field]).map(normalizedKey));
  const key = Object.keys(row).find((candidate) => wanted.has(normalizedKey(candidate)));
  return key == null ? undefined : row[key];
}

const asString = (value: unknown) => value == null || value === "" ? undefined : String(value);

const mapRecord = (row: Record<string, unknown>, source: string, index: number): SyntheticRecord => ({
  source,
  externalId: asString(valueFor(row, "externalId")) ?? `${source}-${index}`,
  nationalId: asString(valueFor(row, "nationalId")),
  firstName: asString(valueFor(row, "firstName")),
  lastName: asString(valueFor(row, "lastName")),
  phone: asString(valueFor(row, "phone")),
  address: asString(valueFor(row, "address")),
  birthDate: asString(valueFor(row, "birthDate")),
  fatherNationalId: asString(valueFor(row, "fatherNationalId")),
  motherNationalId: asString(valueFor(row, "motherNationalId")),
  payload: row,
});

export async function* parseDelimited(file: string, source: string, delimiter = ","): AsyncGenerator<SyntheticRecord> {
  let index = 0;
  const parser = fs.createReadStream(file).pipe(parse({ columns: true, bom: true, delimiter, relax_column_count: true, skip_empty_lines: true }));
  for await (const row of parser) yield mapRecord(row as Record<string, unknown>, source, index++);
}

async function detectDelimiter(file: string) {
  const handle = await fsp.open(file, "r");
  try {
    const buffer = Buffer.alloc(128 * 1024);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const sample = buffer.subarray(0, bytesRead).toString("utf8").split(/\r?\n/).slice(0, 10).join("\n");
    const candidates = ["\t", "|", ";", ","];
    return candidates.sort((a, b) => sample.split(b).length - sample.split(a).length)[0] ?? ",";
  } finally {
    await handle.close();
  }
}

export async function* parseTxt(file: string, source: string): AsyncGenerator<SyntheticRecord> {
  yield* parseDelimited(file, source, await detectDelimiter(file));
}

export async function* parseJsonl(file: string, source: string): AsyncGenerator<SyntheticRecord> {
  const input = fs.createReadStream(file, "utf8");
  let remainder = "";
  let index = 0;
  for await (const chunk of input) {
    remainder += chunk;
    const lines = remainder.split(/\r?\n/);
    remainder = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim()) yield mapRecord(JSON.parse(line) as Record<string, unknown>, source, index++);
    }
  }
  if (remainder.trim()) yield mapRecord(JSON.parse(remainder) as Record<string, unknown>, source, index++);
}

/** Streams a top-level JSON array of objects without reading a multi-GB file into memory. */
export async function* parseJson(file: string, source: string): AsyncGenerator<SyntheticRecord> {
  const input = fs.createReadStream(file, "utf8");
  let token = "";
  let depth = 0;
  let inString = false;
  let escaped = false;
  let started = false;
  let index = 0;
  let rootObject = false;

  for await (const chunk of input) {
    for (const character of chunk) {
      if (!started) {
        if (character === "\ufeff" || /\s/.test(character)) continue;
        started = true;
        if (character === "{") {
          rootObject = true;
          depth = 1;
          token = character;
        } else if (character === "[") {
          rootObject = false;
        } else {
          throw new Error("JSON import must contain an object or an array of objects");
        }
        continue;
      }

      if (rootObject && depth === 0) {
        if (!/\s/.test(character)) throw new Error("Unexpected data after JSON object");
        continue;
      }
      if (!rootObject && depth === 0) {
        if (character === "{") {
          token = character;
          depth = 1;
        } else if (character === "]") {
          return;
        } else if (!/[\s,]/.test(character)) {
          throw new Error("JSON array must contain objects");
        }
        continue;
      }

      token += character;
      if (inString) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') {
        inString = true;
      } else if (character === "{") {
        depth++;
      } else if (character === "}") {
        depth--;
        if (depth === 0) {
          yield mapRecord(JSON.parse(token) as Record<string, unknown>, source, index++);
          token = "";
          if (rootObject) return;
        }
      }
    }
  }
  if (depth !== 0 || inString) throw new Error("Invalid or incomplete JSON object");
}

export async function* parseXlsx(file: string, source: string): AsyncGenerator<SyntheticRecord> {
  const workbook = XLSX.readFile(file, { cellDates: true, dense: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) return;
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: undefined });
  for (let i = 0; i < rows.length; i++) yield mapRecord(rows[i], source, i);
}

function formatFromFileName(name: string): DataImportFormat {
  const lower = name.toLowerCase();
  const ext = path.extname(lower).slice(1);
  if (ext === "csv") return "csv";
  if (ext === "tsv") return "tsv";
  if (ext === "txt") return "txt";
  if (ext === "json") return "json";
  if (ext === "jsonl") return "jsonl";
  if (ext === "ndjson") return "ndjson";
  if (ext === "xlsx") return "xlsx";
  if (ext === "xls") return "xls";
  if (ext === "ods") return "ods";
  throw new Error(`Unsupported archive entry format: ${name}`);
}

async function* parseZip(file: string, source: string): AsyncGenerator<SyntheticRecord> {
  const directory = await unzipper.Open.file(file);
  const entries = directory.files.filter((entry) => !entry.path.endsWith("/") && /\.(csv|tsv|txt|json|jsonl|ndjson|xlsx|xls|ods)$/i.test(entry.path));
  if (entries.length === 0) throw new Error("ZIP must contain CSV, TSV, TXT, JSON, JSONL, NDJSON, XLSX, XLS or ODS");

  for (const entry of entries) {
    const nested = formatFromFileName(entry.path);
    const temp = path.join(path.dirname(file), `${path.basename(file)}.${crypto.randomUUID()}.nested`);
    try {
      await pipeline(entry.stream(), fs.createWriteStream(temp));
      yield* parseFile(temp, nested, source);
    } finally {
      await fsp.rm(temp, { force: true });
    }
  }
}

export async function* parseFile(file: string, format: ImportFormat, source: string, innerFormat?: DataImportFormat): AsyncGenerator<SyntheticRecord> {
  if (format === "csv") { yield* parseDelimited(file, source, ","); return; }
  if (format === "tsv") { yield* parseDelimited(file, source, "\t"); return; }
  if (format === "txt") { yield* parseTxt(file, source); return; }
  if (format === "jsonl" || format === "ndjson") { yield* parseJsonl(file, source); return; }
  if (format === "json") { yield* parseJson(file, source); return; }
  if (format === "xlsx" || format === "xls" || format === "ods") { yield* parseXlsx(file, source); return; }
  if (format === "gzip") {
    const temp = `${file}.${crypto.randomUUID()}.decompressed`;
    try {
      await pipeline(fs.createReadStream(file), createGunzip(), fs.createWriteStream(temp));
      yield* parseFile(temp, innerFormat ?? "csv", source);
    } finally {
      await fsp.rm(temp, { force: true });
    }
    return;
  }
  if (format === "zip") { yield* parseZip(file, source); return; }
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
