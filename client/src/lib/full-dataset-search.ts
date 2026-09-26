const RECORD_BYTES = 16;
const MEDIA_ROOT = "https://media.githubusercontent.com/media/BodekOktzim/maagarim-eg-el-fa/main";
const SEEK_ROOT = `${import.meta.env.BASE_URL}index-seek`;

export type SearchHit = {
  source: string;
  confidence: "exact-id" | "candidate-id-field";
  nationalId: string;
  fullName: string;
  phone?: string;
  address?: string;
  city?: string;
  cityCode?: string;
  age?: string;
  birthDate?: string;
  fatherId?: string;
  motherId?: string;
  spouseId?: string;
};

type IndexSource = {
  key: "agron2006" | "elector" | "facebook";
  file: string;
  records: number;
  indexBytes: number;
  sparseBytes: number;
  sourceBytes: number;
};

type Manifest = {
  format: string;
  recordBytes: number;
  blockRecords: number;
  sources: IndexSource[];
};

let manifestPromise: Promise<Manifest> | undefined;

function normalizeId(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 5 || digits.length > 9) throw new Error("יש להזין תעודת זהות בת 5–9 ספרות.");
  return digits.padStart(9, "0");
}

async function getManifest(): Promise<Manifest> {
  if (!manifestPromise) {
    manifestPromise = fetch(`${SEEK_ROOT}/manifest.json`, { cache: "no-cache" }).then(async (response) => {
      if (!response.ok) throw new Error("לא ניתן לטעון את אינדקס החיפוש מהאתר.");
      const data = await response.json() as Manifest;
      if (data.recordBytes !== RECORD_BYTES || !Array.isArray(data.sources)) throw new Error("אינדקס החיפוש אינו תקין.");
      return data;
    });
  }
  return manifestPromise;
}

async function getByteRange(url: string, start: number, endInclusive: number, label: string): Promise<ArrayBuffer> {
  if (endInclusive < start) return new ArrayBuffer(0);
  const response = await fetch(url, {
    headers: { Range: `bytes=${start}-${endInclusive}` },
    cache: "no-store",
    credentials: "omit",
  });
  if (response.status !== 206) {
    throw new Error(`${label}: שרת הקבצים לא החזיר טווח חלקי (HTTP ${response.status}).`);
  }
  return response.arrayBuffer();
}

function readSparseRecord(view: DataView, index: number) {
  const byte = index * RECORD_BYTES;
  return { id: view.getUint32(byte, true), ordinal: Number(view.getBigUint64(byte + 4, true)) };
}

async function findMatchingIndexRecords(source: IndexSource, targetId: number, blockRecords: number) {
  const sparseUrl = `${SEEK_ROOT}/${source.key}.sparse.bin`;
  const sparseResponse = await fetch(sparseUrl, { cache: "no-cache" });
  if (!sparseResponse.ok) throw new Error(`לא ניתן לטעון אינדקס דליל עבור ${source.key}.`);
  const sparseBuffer = await sparseResponse.arrayBuffer();
  if (sparseBuffer.byteLength % RECORD_BYTES) throw new Error(`אינדקס דליל פגום עבור ${source.key}.`);
  const sparseView = new DataView(sparseBuffer);
  const sparseCount = sparseBuffer.byteLength / RECORD_BYTES;

  let low = 0;
  let high = sparseCount;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (readSparseRecord(sparseView, mid).id < targetId) low = mid + 1;
    else high = mid;
  }
  const firstAtOrAfter = low;
  const startOrdinal = firstAtOrAfter === 0 ? 0 : readSparseRecord(sparseView, firstAtOrAfter - 1).ordinal;

  let firstGreater = firstAtOrAfter;
  while (firstGreater < sparseCount && readSparseRecord(sparseView, firstGreater).id <= targetId) firstGreater += 1;
  const totalRecords = source.indexBytes / RECORD_BYTES;
  const endOrdinal = firstGreater < sparseCount ? readSparseRecord(sparseView, firstGreater).ordinal : totalRecords;
  if (endOrdinal <= startOrdinal) return [];

  // At most two blocks for an absent/sparse hit. Large duplicate groups are guarded
  // against unexpectedly expensive downloads; normal elector matches are very small.
  const maxIndexRecords = Math.max(blockRecords * 4, 16_384);
  if (endOrdinal - startOrdinal > maxIndexRecords) {
    throw new Error(`נמצאו יותר מדי התאמות ב-${source.key}; החיפוש נעצר כדי למנוע הורדה גדולה.`);
  }
  const indexUrl = `${MEDIA_ROOT}/search-index-full/${source.key}.bin`;
  const buffer = await getByteRange(indexUrl, startOrdinal * RECORD_BYTES, endOrdinal * RECORD_BYTES - 1, source.key);
  if (buffer.byteLength % RECORD_BYTES) throw new Error(`טווח אינדקס פגום עבור ${source.key}.`);
  const view = new DataView(buffer);
  const records: Array<{ offset: number; length: number }> = [];
  for (let byte = 0; byte < buffer.byteLength; byte += RECORD_BYTES) {
    if (view.getUint32(byte, true) !== targetId) continue;
    const offset = Number(view.getBigUint64(byte + 4, true));
    const length = view.getUint32(byte + 12, true);
    records.push({ offset, length });
    if (records.length >= 80) break;
  }
  return records;
}

function parseDelimitedRow(line: string, delimiter: string, quote: string) {
  const fields: string[] = [];
  let value = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === quote) {
      if (quoted && line[i + 1] === quote) {
        value += quote;
        i += 1;
      } else if (quoted) {
        quoted = false;
      } else if (value.length === 0) {
        quoted = true;
      } else {
        value += char;
      }
    } else if (char === delimiter && !quoted) {
      fields.push(value);
      value = "";
    } else {
      value += char;
    }
  }
  fields.push(value);
  return fields.map((field) => field.trim());
}

function mapHit(source: IndexSource, line: string, target: string): SearchHit | null {
  let fields: string[];
  if (source.key === "agron2006") fields = parseDelimitedRow(line, "\t", "\u0000");
  else if (source.key === "elector") fields = parseDelimitedRow(line, ",", "'");
  else fields = line.replace(/[\r\n]+$/, "").split(":");

  if (source.key === "agron2006") {
    const nationalId = fields[0] ?? target;
    const street = fields[7] ?? "";
    const house = fields[8] ?? "";
    const apartment = fields[10] ?? "";
    const city = fields[11] ?? "";
    const address = [street, house && `בית ${house}`, apartment && `דירה ${apartment}`].filter(Boolean).join(" ");
    return {
      source: "AGRON 2006",
      confidence: "exact-id",
      nationalId,
      fullName: [fields[1], fields[2]].filter(Boolean).join(" ") || "ללא שם בקובץ",
      phone: fields[13] || undefined,
      address: address || undefined,
      city: city || undefined,
      age: fields[14] || undefined,
      birthDate: fields[15] || undefined,
      fatherId: fields[20] || undefined,
      motherId: fields[22] || undefined,
      spouseId: fields[23] || undefined,
    };
  }
  if (source.key === "elector") {
    return {
      source: "Elector",
      confidence: "exact-id",
      nationalId: fields[3] || target,
      fullName: [fields[1], fields[2]].filter(Boolean).join(" ") || "ללא שם בקובץ",
      phone: fields[4] || undefined,
      address: fields[5] || undefined,
      cityCode: fields[9] || undefined,
    };
  }
  return {
    source: "Facebook (התאמה מספרית לבדיקה)",
    confidence: "candidate-id-field",
    nationalId: fields[1] || target,
    fullName: "רשומת מקור — שדות לא ממופים",
  };
}

async function fetchSourceRow(source: IndexSource, record: { offset: number; length: number }, target: string) {
  const url = `${MEDIA_ROOT}/datasets/${encodeURIComponent(source.file)}`;
  const buffer = await getByteRange(url, record.offset, record.offset + record.length - 1, source.file);
  const line = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
  return mapHit(source, line, target);
}

export async function searchFullDatasetsById(input: string) {
  const normalized = normalizeId(input);
  const target = Number(normalized);
  const manifest = await getManifest();
  const blockRecords = manifest.blockRecords || 4096;
  const all = await Promise.all(manifest.sources.map(async (source) => {
    const indexRecords = await findMatchingIndexRecords(source, target, blockRecords);
    const limited = indexRecords.slice(0, 40);
    const hits = await Promise.all(limited.map((record) => fetchSourceRow(source, record, normalized)));
    return hits.filter((hit): hit is SearchHit => Boolean(hit));
  }));
  return { normalizedId: normalized, hits: all.flat() };
}
