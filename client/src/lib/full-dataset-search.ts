const RECORD_BYTES = 16;
const MEDIA_ROOT = "https://media.githubusercontent.com/media/BodekOktzim/maagarim-eg-el-fa/main";
const INDEX_ROOT = "https://raw.githubusercontent.com/BodekOktzim/maagarim-eg-el-fa/main";
const SEEK_ROOT = `${import.meta.env.BASE_URL}index-seek`;

type SourceKey = "agron2006" | "elector" | "facebook";

export type SearchHit = {
  source: string;
  sourceKey: SourceKey;
  confidence: "exact-id" | "candidate-id-field" | "phone-match" | "facebook-id-match" | "text-match";
  nationalId: string;
  fullName: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  phoneYear?: string;
  address?: string;
  addressYear?: string;
  city?: string;
  cityCode?: string;
  age?: string;
  birthDate?: string;
  fatherId?: string;
  motherId?: string;
  spouseId?: string;
  facebookId?: string;
};

export type TextSearchCriteria = {
  firstName?: string;
  lastName?: string;
  city?: string;
  age?: string;
};

export type FamilyTreePerson = {
  id: string;
  nationalId?: string;
  fullName: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  address?: string;
  city?: string;
  birthDate?: string;
  age?: string;
  sourceNames?: string[];
};

export type FamilyTreeRelationship = {
  id: string;
  personAId: string;
  personBId: string;
  type: "PARENT" | "CHILD" | "SIBLING";
  confidence?: string;
  evidence?: Record<string, unknown>;
  source?: string;
};

export type FamilyTreeData = {
  people: FamilyTreePerson[];
  relationships: FamilyTreeRelationship[];
};

type IndexSource = {
  key: SourceKey;
  file: string;
  records: number;
  indexBytes: number;
  sparseBytes: number;
  sourceBytes: number;
};

type IdManifest = {
  format: string;
  recordBytes: number;
  blockRecords: number;
  sources: IndexSource[];
};

type ExtensionIndex = {
  source: string;
  dataFile: string;
  records: number;
  indexFile: string;
  kind: "postings" | "age" | "facebook-id" | "edges";
  confidence?: string;
  indexBytes: number;
  sparseFile: string;
  sparseBytes: number;
  blockRecords: number;
};

type ExtensionManifest = {
  format: string;
  postRecordBytes: number;
  facebookIdRecordBytes: number;
  edgeRecordBytes: number;
  blockRecords: number;
  indexes: Record<string, ExtensionIndex>;
};

type RowPointer = { offset: number; length: number };

let idManifestPromise: Promise<IdManifest> | undefined;
let extensionManifestPromise: Promise<ExtensionManifest> | undefined;
const sparseCache = new Map<string, Promise<ArrayBuffer>>();
const idSearchCache = new Map<string, Promise<SearchHit[]>>();
const rowCache = new Map<string, Promise<SearchHit | null>>();

function digitsOnly(value: string) {
  return value.replace(/\D/g, "");
}

function normalizeId(value: string) {
  const digits = digitsOnly(value);
  if (digits.length < 5 || digits.length > 9) throw new Error("יש להזין תעודת זהות בת 5–9 ספרות.");
  return digits.padStart(9, "0");
}

function normalizedPhone(value: string) {
  let digits = digitsOnly(value);
  if (digits.startsWith("00972")) digits = `0${digits.slice(5)}`;
  else if (digits.startsWith("972")) digits = `0${digits.slice(3)}`;
  if (digits.length < 7 || digits.length > 15) throw new Error("יש להזין מספר טלפון תקין, כולל קידומת אם נדרשת.");
  return digits;
}

function normalizeText(value: string) {
  return value.toLowerCase().replace(/[׳'".,]/g, "").replace(/\s+/g, " ").trim();
}

function bigrams(value: string) {
  const text = normalizeText(value);
  const output = new Set<string>();
  for (let i = 0; i + 1 < text.length; i += 1) output.add(text.slice(i, i + 2));
  return Array.from(output);
}

function hash32(value: string) {
  let hash = 2166136261;
  const bytes = new TextEncoder().encode(value);
  for (let index = 0; index < bytes.length; index += 1) {
    const byte = bytes[index];
    hash ^= byte;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

async function getManifest(): Promise<IdManifest> {
  if (!idManifestPromise) {
    idManifestPromise = fetch(`${SEEK_ROOT}/manifest.json`, { cache: "no-cache" }).then(async (response) => {
      if (!response.ok) throw new Error("לא ניתן לטעון את אינדקס החיפוש מהאתר.");
      const data = await response.json() as IdManifest;
      if (data.recordBytes !== RECORD_BYTES || !Array.isArray(data.sources)) throw new Error("אינדקס החיפוש אינו תקין.");
      return data;
    });
  }
  return idManifestPromise;
}

async function getExtensionManifest(): Promise<ExtensionManifest> {
  if (!extensionManifestPromise) {
    extensionManifestPromise = fetch(`${SEEK_ROOT}/extensions-manifest.json`, { cache: "no-cache" }).then(async (response) => {
      if (!response.ok) throw new Error("אינדקסי החיפוש המורחבים עדיין אינם זמינים באתר.");
      const data = await response.json() as ExtensionManifest;
      if (!data.indexes || data.postRecordBytes !== 16 || data.edgeRecordBytes !== 20) throw new Error("מבנה אינדקס החיפוש המורחב אינו תקין.");
      return data;
    });
  }
  return extensionManifestPromise;
}

async function getByteRange(url: string, start: number, endInclusive: number, label: string): Promise<ArrayBuffer> {
  if (endInclusive < start) return new ArrayBuffer(0);
  const response = await fetch(url, {
    headers: { Range: `bytes=${start}-${endInclusive}` },
    cache: "no-store",
    credentials: "omit",
  });
  if (response.status !== 206) throw new Error(`${label}: שרת הקבצים לא החזיר טווח חלקי (HTTP ${response.status}).`);
  return response.arrayBuffer();
}

function readSparse32(view: DataView, index: number) {
  const byte = index * 12;
  return { key: view.getUint32(byte, true), ordinal: Number(view.getBigUint64(byte + 4, true)) };
}

function readSparse64(view: DataView, index: number) {
  const byte = index * 16;
  return { key: view.getBigUint64(byte, true), ordinal: Number(view.getBigUint64(byte + 8, true)) };
}

async function getSparse(file: string) {
  const url = `${SEEK_ROOT}/${file}`;
  if (!sparseCache.has(url)) {
    sparseCache.set(url, fetch(url, { cache: "no-cache" }).then(async (response) => {
      if (!response.ok) throw new Error(`לא ניתן לטעון את קובץ העזר ${file}.`);
      return response.arrayBuffer();
    }));
  }
  return sparseCache.get(url)!;
}

async function findSparseRange(meta: ExtensionIndex, target: number | bigint, keyBytes = 4, recordBytes = 16) {
  const buffer = await getSparse(meta.sparseFile);
  const sparseRecordBytes = keyBytes === 8 ? 16 : 12;
  if (buffer.byteLength % sparseRecordBytes) throw new Error(`קובץ אינדקס עזר פגום: ${meta.sparseFile}.`);
  const view = new DataView(buffer);
  const count = buffer.byteLength / sparseRecordBytes;
  const read = keyBytes === 8 ? readSparse64 : readSparse32;
  const targetBig = typeof target === "bigint" ? target : BigInt(target >>> 0);
  let low = 0;
  let high = count;
  while (low < high) {
    const mid = (low + high) >>> 1;
    const key = BigInt(read(view, mid).key);
    if (key < targetBig) low = mid + 1;
    else high = mid;
  }
  const firstAtOrAfter = low;
  const startOrdinal = firstAtOrAfter === 0 ? 0 : read(view, firstAtOrAfter - 1).ordinal;
  let firstGreater = firstAtOrAfter;
  while (firstGreater < count && BigInt(read(view, firstGreater).key) <= targetBig) firstGreater += 1;
  const totalRecords = meta.indexBytes / recordBytes;
  const endOrdinal = firstGreater < count ? read(view, firstGreater).ordinal : totalRecords;
  return { startOrdinal, endOrdinal, totalRecords };
}

async function readPostingGroup(meta: ExtensionIndex, key: number, cap: number, allowPartial = false) {
  const range = await findSparseRange(meta, key, 4, 16);
  const count = range.endOrdinal - range.startOrdinal;
  if (count <= 0) return { count: 0, records: [] as RowPointer[] };
  if (count > cap && !allowPartial) throw new Error("נמצאו יותר מדי מועמדים לפי מפתח זה. הוסיפו שם משפחה, יישוב או גיל כדי לצמצם את החיפוש.");
  const sampledEnd = allowPartial ? Math.min(range.endOrdinal, range.startOrdinal + cap) : range.endOrdinal;
  const buffer = await getByteRange(`${INDEX_ROOT}/search-index-full/${meta.indexFile}`, range.startOrdinal * 16, sampledEnd * 16 - 1, meta.indexFile);
  if (buffer.byteLength % 16) throw new Error(`טווח אינדקס פגום עבור ${meta.indexFile}.`);
  const view = new DataView(buffer);
  const records: RowPointer[] = [];
  for (let byte = 0; byte < buffer.byteLength; byte += 16) {
    if (view.getUint32(byte, true) !== key) continue;
    records.push({ offset: Number(view.getBigUint64(byte + 4, true)), length: view.getUint32(byte + 12, true) });
  }
  return { count: records.length, records };
}

async function readFacebookIdGroup(meta: ExtensionIndex, target: bigint, cap: number) {
  const range = await findSparseRange(meta, target, 8, 20);
  const count = range.endOrdinal - range.startOrdinal;
  if (count <= 0) return [] as RowPointer[];
  if (count > cap) throw new Error("נמצאו יותר מדי התאמות מספריות במקור Facebook. צמצמו את החיפוש.");
  const buffer = await getByteRange(`${INDEX_ROOT}/search-index-full/${meta.indexFile}`, range.startOrdinal * 20, range.endOrdinal * 20 - 1, meta.indexFile);
  const view = new DataView(buffer);
  const records: RowPointer[] = [];
  for (let byte = 0; byte + 20 <= buffer.byteLength; byte += 20) {
    if (view.getBigUint64(byte, true) !== target) continue;
    records.push({ offset: Number(view.getBigUint64(byte + 8, true)), length: view.getUint32(byte + 16, true) });
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
      if (quoted && line[i + 1] === quote) { value += quote; i += 1; }
      else if (quoted) quoted = false;
      else if (value.length === 0) quoted = true;
      else value += char;
    } else if (char === delimiter && !quoted) { fields.push(value); value = ""; }
    else value += char;
  }
  fields.push(value);
  return fields.map((field) => field.trim());
}

function displayId(value?: string) {
  const digits = value ? digitsOnly(value) : "";
  return digits.length >= 5 && digits.length <= 9 ? digits.padStart(9, "0") : undefined;
}

export function currentAgeFromBirthDate(value?: string) {
  if (!value) return undefined;
  const match = value.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (!match) return undefined;
  const birthYear = Number(match[1]);
  const birthMonth = Number(match[2]);
  const birthDay = Number(match[3]);
  const today = new Date();
  let age = today.getFullYear() - birthYear;
  const birthdayPassed = today.getMonth() + 1 > birthMonth || (today.getMonth() + 1 === birthMonth && today.getDate() >= birthDay);
  if (!birthdayPassed) age -= 1;
  return age >= 0 && age <= 130 ? String(age) : undefined;
}

function parseHit(source: IndexSource, line: string, target = "") : SearchHit | null {
  let fields: string[];
  if (source.key === "agron2006") fields = parseDelimitedRow(line, "\t", "\u0000");
  else if (source.key === "elector") fields = parseDelimitedRow(line, ",", "'");
  else fields = line.replace(/[\r\n]+$/, "").split(":");

  if (source.key === "agron2006") {
    const firstName = fields[1] ?? "";
    const lastName = fields[2] ?? "";
    const street = fields[7] ?? "";
    const house = fields[8] ?? "";
    const apartment = fields[10] ?? "";
    const address = [street, house && `בית ${house}`, apartment && `דירה ${apartment}`].filter(Boolean).join(" ");
    return {
      source: "AGRON 2006", sourceKey: source.key, confidence: "exact-id", nationalId: displayId(fields[0]) ?? target,
      firstName, lastName, fullName: [firstName, lastName].filter(Boolean).join(" ") || "ללא שם בקובץ",
      phone: fields[13] || undefined, address: address || undefined, city: fields[11] || undefined, age: (currentAgeFromBirthDate(fields[15]) ?? fields[14]) || undefined, birthDate: fields[15] || undefined,
      fatherId: displayId(fields[20]), motherId: displayId(fields[22]), spouseId: displayId(fields[23]),
    };
  }
  if (source.key === "elector") {
    const firstName = fields[1] ?? "";
    const lastName = fields[2] ?? "";
    return {
      source: "Elector", sourceKey: source.key, confidence: "exact-id", nationalId: displayId(fields[3]) ?? target,
      firstName, lastName, fullName: [firstName, lastName].filter(Boolean).join(" ") || "ללא שם בקובץ",
      phone: fields[4] || undefined, address: fields[5] || undefined, cityCode: fields[9] || undefined,
    };
  }
  const firstName = fields[2] ?? "";
  const lastName = fields[3] ?? "";
  return {
    source: "Facebook (התאמה מועמדת)", sourceKey: source.key, confidence: "candidate-id-field", nationalId: displayId(fields[1]) ?? target,
    firstName, lastName, fullName: [firstName, lastName].filter(Boolean).join(" ") || "רשומת מקור — שדות לא ממופים",
    phone: fields[0] || undefined, facebookId: fields[1] || undefined,
  };
}

export function mergeHits(hits: SearchHit[]): SearchHit[] {
  const groups = new Map<string, SearchHit[]>();
  for (const hit of hits) {
    const key = displayId(hit.nationalId) ?? hit.facebookId ?? `${hit.sourceKey}:${hit.fullName}:${hit.phone ?? ""}`;
    const group = groups.get(key) ?? [];
    group.push(hit);
    groups.set(key, group);
  }
  return Array.from(groups.values()).map((group) => {
    const elector = group.find((hit) => hit.sourceKey === "elector");
    const agron = group.find((hit) => hit.sourceKey === "agron2006");
    const facebook = group.find((hit) => hit.sourceKey === "facebook");
    const newestFirst = [elector, agron, facebook, ...group].filter((hit, index, values): hit is SearchHit => Boolean(hit) && values.indexOf(hit) === index);
    const pick = <K extends keyof SearchHit>(field: K) => newestFirst.find((hit) => hit[field] !== undefined && hit[field] !== "")?.[field];
    const family = agron ?? elector ?? facebook ?? group[0];
    return {
      ...family,
      source: "מאגר מאוחד",
      sourceKey: family.sourceKey,
      confidence: family.confidence,
      nationalId: pick("nationalId") ?? family.nationalId,
      firstName: pick("firstName") ?? family.firstName,
      lastName: pick("lastName") ?? family.lastName,
      fullName: [pick("firstName") ?? family.firstName, pick("lastName") ?? family.lastName].filter(Boolean).join(" ") || family.fullName,
      phone: pick("phone"),
      phoneYear: elector?.phone ? "2020" : agron?.phone ? "2006" : undefined,
      address: pick("address"),
      addressYear: elector?.address ? "2020" : agron?.address ? "2006" : undefined,
      city: pick("city"),
      age: pick("age"),
      birthDate: pick("birthDate"),
      facebookId: pick("facebookId"),
      fatherId: agron?.fatherId ?? family.fatherId,
      motherId: agron?.motherId ?? family.motherId,
      spouseId: agron?.spouseId ?? family.spouseId,
    };
  });
}

export function mergePhoneHits(hits: SearchHit[]): SearchHit[] {
  const primary = mergeHits(hits.filter((hit) => hit.sourceKey !== "facebook"));
  const facebook = hits.filter((hit) => hit.sourceKey === "facebook");
  const uniqueFacebook = Array.from(new Map(facebook.map((hit) => [`${hit.facebookId ?? ""}:${hit.nationalId}:${hit.fullName}`, hit])).values());
  return [...primary, ...uniqueFacebook];
}

async function fetchSourceRow(source: IndexSource, record: RowPointer, target: string) {
  const cacheKey = `${source.key}:${record.offset}:${record.length}`;
  if (!rowCache.has(cacheKey)) {
    rowCache.set(cacheKey, getByteRange(`${MEDIA_ROOT}/datasets/${encodeURIComponent(source.file)}`, record.offset, record.offset + record.length - 1, source.file)
      .then((buffer) => parseHit(source, new TextDecoder("utf-8", { fatal: false }).decode(buffer), target)));
  }
  return rowCache.get(cacheKey)!;
}

export async function searchFullDatasetsById(input: string): Promise<SearchHit[]> {
  const normalized = normalizeId(input);
  if (!idSearchCache.has(normalized)) {
    idSearchCache.set(normalized, (async () => {
      const targetId = Number(normalized);
      const manifest = await getManifest();
      const blockRecords = manifest.blockRecords || 4096;
      const results = await Promise.all(manifest.sources.map(async (source) => {
        const sparseBuffer = await getSparse(`${source.key}.sparse.bin`);
        if (sparseBuffer.byteLength % RECORD_BYTES) throw new Error(`אינדקס דליל פגום עבור ${source.key}.`);
        const sparseView = new DataView(sparseBuffer);
        const sparseCount = sparseBuffer.byteLength / RECORD_BYTES;
        let low = 0;
        let high = sparseCount;
        while (low < high) {
          const mid = (low + high) >>> 1;
          if (sparseView.getUint32(mid * RECORD_BYTES, true) < targetId) low = mid + 1;
          else high = mid;
        }
        const firstAtOrAfter = low;
        const startOrdinal = firstAtOrAfter === 0 ? 0 : Number(sparseView.getBigUint64((firstAtOrAfter - 1) * RECORD_BYTES + 4, true));
        let firstGreater = firstAtOrAfter;
        while (firstGreater < sparseCount && sparseView.getUint32(firstGreater * RECORD_BYTES, true) <= targetId) firstGreater += 1;
        const totalRecords = source.indexBytes / RECORD_BYTES;
        const endOrdinal = firstGreater < sparseCount ? Number(sparseView.getBigUint64(firstGreater * RECORD_BYTES + 4, true)) : totalRecords;
        if (endOrdinal <= startOrdinal) return [];
        if (endOrdinal - startOrdinal > Math.max(blockRecords * 4, 16_384)) throw new Error(`נמצאו יותר מדי התאמות ב-${source.key}; החיפוש נעצר כדי למנוע הורדה גדולה.`);
        const buffer = await getByteRange(`${INDEX_ROOT}/search-index-full/${source.key}.bin`, startOrdinal * RECORD_BYTES, endOrdinal * RECORD_BYTES - 1, source.key);
        if (buffer.byteLength % RECORD_BYTES) throw new Error(`טווח אינדקס פגום עבור ${source.key}.`);
        const view = new DataView(buffer);
        const pointers: RowPointer[] = [];
        for (let byte = 0; byte < buffer.byteLength; byte += RECORD_BYTES) {
          if (view.getUint32(byte, true) !== targetId) continue;
          pointers.push({ offset: Number(view.getBigUint64(byte + 4, true)), length: view.getUint32(byte + 12, true) });
          if (pointers.length >= 40) break;
        }
        const hits = await Promise.all(pointers.map((pointer) => fetchSourceRow(source, pointer, normalized)));
        return hits.filter((hit): hit is SearchHit => Boolean(hit));
      }));
      return mergeHits(results.flat());
    })());
  }
  return idSearchCache.get(normalized)!;
}

function criteriaForSource(criteria: TextSearchCriteria, sourceKey: SourceKey) {
  const output: { indexKey: string; field: keyof SearchHit; value: string }[] = [];
  if (criteria.firstName?.trim()) {
    const indexKey = sourceKey === "agron2006" ? "text-agron-first" : sourceKey === "elector" ? "text-elector-first" : "text-facebook-first-candidate";
    output.push({ indexKey, field: "firstName", value: criteria.firstName.trim() });
  }
  if (criteria.lastName?.trim()) {
    const indexKey = sourceKey === "agron2006" ? "text-agron-last" : sourceKey === "elector" ? "text-elector-last" : "text-facebook-last-candidate";
    output.push({ indexKey, field: "lastName", value: criteria.lastName.trim() });
  }
  if (criteria.city?.trim() && sourceKey === "agron2006") output.push({ indexKey: "text-agron-city", field: "city", value: criteria.city.trim() });
  return output;
}

function textMatches(hit: SearchHit, criteria: TextSearchCriteria) {
  for (const field of ["firstName", "lastName", "city"] as const) {
    const term = criteria[field]?.trim();
    if (term && !normalizeText(String(hit[field] ?? "")).includes(normalizeText(term))) return false;
  }
  if (criteria.age && String(Number(hit.age)) !== String(Number(criteria.age))) return false;
  return true;
}

async function mapLimit<T, R>(items: T[], limit: number, map: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await map(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

async function searchTextInSource(source: IndexSource, criteria: TextSearchCriteria, extensions: ExtensionManifest) {
  if (criteria.age && source.key !== "agron2006") return [] as SearchHit[];
  const criteriaItems = criteriaForSource(criteria, source.key);
  const candidates: { meta: ExtensionIndex; key: number; value: string; field: keyof SearchHit; count: number }[] = [];
  for (const criterion of criteriaItems) {
    const grams = bigrams(criterion.value);
    if (normalizeText(criterion.value).length < 2) throw new Error("בחיפוש לפי שם או יישוב יש להזין לפחות שתי אותיות.");
    for (const gram of grams) {
      const meta = extensions.indexes[criterion.indexKey];
      if (!meta) continue;
      const key = hash32(gram);
      const range = await findSparseRange(meta, key, 4, 16);
      const count = Math.max(0, range.endOrdinal - range.startOrdinal);
      if (count) candidates.push({ meta, key, value: criterion.value, field: criterion.field, count });
    }
  }
  if (criteria.age && source.key === "agron2006") {
    const meta = extensions.indexes["age-agron"];
    const key = Number(criteria.age);
    if (meta && Number.isInteger(key)) {
      const range = await findSparseRange(meta, key, 4, 16);
      const count = Math.max(0, range.endOrdinal - range.startOrdinal);
      if (count) candidates.push({ meta, key, value: criteria.age, field: "age", count });
    }
  }
  if (!candidates.length) return [] as SearchHit[];
  const selected = candidates.reduce((best, candidate) => candidate.count < best.count ? candidate : best);
  const group = await readPostingGroup(selected.meta, selected.key, 300_000, true);
  const seen = new Set<number>();
  const pointers = group.records.filter((pointer) => {
    if (seen.has(pointer.offset)) return false;
    seen.add(pointer.offset);
    return true;
  }).slice(0, 400);
  const hits = await mapLimit(pointers, 16, (pointer) => fetchSourceRow(source, pointer, ""));
  return hits.filter((hit): hit is SearchHit => Boolean(hit && textMatches(hit, criteria))).slice(0, 250);
}

export async function searchFullDatasetsByText(criteria: TextSearchCriteria) {
  const hasText = Boolean(criteria.firstName?.trim() || criteria.lastName?.trim() || criteria.city?.trim());
  const age = criteria.age?.trim() ?? "";
  if (!hasText && !age) throw new Error("יש למלא לפחות שדה חיפוש אחד.");
  if (age && (!/^\d{1,3}$/.test(age) || Number(age) < 1 || Number(age) > 120)) throw new Error("יש להזין גיל בין 1 ל־120.");
  for (const value of [criteria.firstName, criteria.lastName, criteria.city]) {
    if (value?.trim() && normalizeText(value).length < 2) throw new Error("בחיפוש לפי שם או יישוב יש להזין לפחות שתי אותיות.");
  }
  const [manifest, extensions] = await Promise.all([getManifest(), getExtensionManifest()]);
  const hits = await Promise.all(manifest.sources.map((source) => searchTextInSource(source, criteria, extensions)));
  return mergeHits(hits.flat()).slice(0, 250);
}

function phoneMatches(hit: SearchHit, phone: string) {
  if (!hit.phone) return false;
  try { return normalizedPhone(hit.phone) === phone; } catch { return false; }
}

export async function searchFullDatasetsByPhone(input: string) {
  const phone = normalizedPhone(input);
  const [manifest, extensions] = await Promise.all([getManifest(), getExtensionManifest()]);
  const all = await Promise.all(manifest.sources.map(async (source) => {
    const key = source.key === "agron2006" ? "phone-agron" : source.key === "elector" ? "phone-elector" : "phone-facebook-candidate";
    const meta = extensions.indexes[key];
    if (!meta) return [] as SearchHit[];
    const group = await readPostingGroup(meta, hash32(phone), 20_000);
    const pointers = group.records.slice(0, 500);
    const hits = await Promise.all(pointers.map((pointer) => fetchSourceRow(source, pointer, "")));
    return hits.filter((hit): hit is SearchHit => Boolean(hit && phoneMatches(hit, phone))).map((hit) => ({ ...hit, confidence: "phone-match" as const }));
  }));
  return mergePhoneHits(all.flat());
}

export async function searchFullDatasetsByFacebookId(input: string) {
  const digits = digitsOnly(input);
  if (!/^\d{1,18}$/.test(digits)) throw new Error("יש להזין מזהה Facebook מספרי בן 1–18 ספרות.");
  const target = BigInt(digits);
  const [manifest, extensions] = await Promise.all([getManifest(), getExtensionManifest()]);
  const source = manifest.sources.find((item) => item.key === "facebook");
  const meta = extensions.indexes["facebook-id"];
  if (!source || !meta) throw new Error("אינדקס מזהי Facebook אינו זמין.");
  const pointers = await readFacebookIdGroup(meta, target, 100);
  const hits = await Promise.all(pointers.map((pointer) => fetchSourceRow(source, pointer, "")));
  return hits.filter((hit): hit is SearchHit => Boolean(hit)).map((hit) => ({ ...hit, confidence: "facebook-id-match" as const, facebookId: digits }));
}

async function getChildren(parentId: string, extensions: ExtensionManifest) {
  const meta = extensions.indexes["family-agron-parent-child"];
  if (!meta) return [] as string[];
  const key = Number(normalizeId(parentId));
  const range = await findSparseRange(meta, key, 4, 20);
  const count = range.endOrdinal - range.startOrdinal;
  if (count <= 0) return [] as string[];
  if (count > 5000) throw new Error("הקשר כולל מספר גדול מדי של רשומות; הוגבלה טעינת העץ.");
  const buffer = await getByteRange(`${INDEX_ROOT}/search-index-full/${meta.indexFile}`, range.startOrdinal * 20, range.endOrdinal * 20 - 1, meta.indexFile);
  const view = new DataView(buffer);
  const ids = new Set<string>();
  for (let byte = 0; byte + 20 <= buffer.byteLength; byte += 20) {
    if (view.getUint32(byte, true) === key) ids.add(String(view.getUint32(byte + 4, true)).padStart(9, "0"));
  }
  return Array.from(ids).slice(0, 120);
}

async function getPeople(ids: string[]) {
  const unique = Array.from(new Set(ids.map((id) => displayId(id) ?? "").filter(Boolean))).slice(0, 120);
  const results = await Promise.all(unique.map(async (id) => {
    const hits = await searchFullDatasetsById(id);
    return { id, hits };
  }));
  const people = new Map<string, FamilyTreePerson>();
  const relationships: FamilyTreeRelationship[] = [];
  for (const { id, hits } of results) {
    const agron = hits.find((hit) => hit.sourceKey === "agron2006");
    const primary = agron ?? hits.find((hit) => hit.sourceKey === "elector") ?? hits[0];
    if (!primary) {
      people.set(id, { id, nationalId: id, fullName: "לא נמצאה רשומה במקורות" });
      continue;
    }
    const sources = Array.from(new Set(hits.map((hit) => hit.source)));
    people.set(id, {
      id, nationalId: primary.nationalId, fullName: primary.fullName, firstName: primary.firstName, lastName: primary.lastName,
      phone: primary.phone, address: primary.address, city: primary.city, birthDate: primary.birthDate, age: primary.age, sourceNames: sources,
    });
    if (agron?.fatherId) relationships.push({ id: `${id}-father-${agron.fatherId}`, personAId: id, personBId: agron.fatherId, type: "PARENT", source: "AGRON 2006", confidence: "source-backed", evidence: { field: "father" } });
    if (agron?.motherId) relationships.push({ id: `${id}-mother-${agron.motherId}`, personAId: id, personBId: agron.motherId, type: "PARENT", source: "AGRON 2006", confidence: "source-backed", evidence: { field: "mother" } });
  }
  return { people, relationships };
}

export async function searchFamilyTreeById(input: string): Promise<FamilyTreeData> {
  const centralId = normalizeId(input);
  const extensions = await getExtensionManifest();
  const centerHits = await searchFullDatasetsById(centralId);
  const centerAgron = centerHits.find((hit) => hit.sourceKey === "agron2006");
  const parentIds = [centerAgron?.fatherId, centerAgron?.motherId].filter((id): id is string => Boolean(id));
  const childIds = await getChildren(centralId, extensions);
  const parentsChildren = await Promise.all(parentIds.map((id) => getChildren(id, extensions)));
  const siblingIds = Array.from(new Set(parentsChildren.flat().filter((id) => id !== centralId)));
  const parentRecords = await Promise.all(parentIds.map((id) => searchFullDatasetsById(id)));
  const parentHits = parentRecords.flat();
  const grandparents = Array.from(new Set(parentHits.filter((hit) => hit.sourceKey === "agron2006").flatMap((hit) => [hit.fatherId, hit.motherId].filter((value): value is string => Boolean(value)))));
  const greatGrandparentHits = (await Promise.all(grandparents.map((id) => searchFullDatasetsById(id)))).flat();
  const greatGrandparentIds = Array.from(new Set(greatGrandparentHits.filter((hit) => hit.sourceKey === "agron2006").flatMap((hit) => [hit.fatherId, hit.motherId].filter((value): value is string => Boolean(value)))));
  const grandparentChildren = await Promise.all(grandparents.map((id) => getChildren(id, extensions)));
  const auntUncleIds = Array.from(new Set(grandparentChildren.flat().filter((id) => !parentIds.includes(id))));
  const cousinLists = await Promise.all(auntUncleIds.map((id) => getChildren(id, extensions)));
  const cousinIds = Array.from(new Set(cousinLists.flat().filter((id) => id !== centralId && !siblingIds.includes(id))));
  const coParentIds = Array.from(new Set((await Promise.all(childIds.map(async (id) => {
    const hits = await searchFullDatasetsById(id);
    const hit = hits.find((item) => item.sourceKey === "agron2006");
    return [hit?.fatherId, hit?.motherId].filter((value): value is string => Boolean(value) && value !== centralId);
  }))).flat()));
  const allIds = Array.from(new Set([centralId, ...parentIds, ...childIds, ...siblingIds, ...grandparents, ...greatGrandparentIds, ...auntUncleIds, ...cousinIds, ...coParentIds]));
  const graph = await getPeople(allIds);
  const siblingEdges: FamilyTreeRelationship[] = [];
  const siblingSet = new Set<string>();
  for (const parentId of parentIds) {
    const children = Array.from(new Set((parentsChildren[parentIds.indexOf(parentId)] ?? []).concat(centralId)));
    for (const siblingId of children) {
      if (siblingId === centralId) continue;
      const pairKey = [centralId, siblingId].sort().join(":");
      if (!siblingSet.has(pairKey)) {
        siblingSet.add(pairKey);
        siblingEdges.push({ id: `sib-${pairKey}`, personAId: centralId, personBId: siblingId, type: "SIBLING", source: "AGRON 2006", confidence: "inferred-from-shared-parent" });
      }
    }
  }
  for (let index = 0; index < parentIds.length; index += 1) {
    const parentId = parentIds[index];
    const parentRecord = parentRecords[index]?.find((hit) => hit.sourceKey === "agron2006");
    const parentsOfParent = [parentRecord?.fatherId, parentRecord?.motherId].filter((id): id is string => Boolean(id));
    const parentSiblings = Array.from(new Set(parentsOfParent.flatMap((grandparentId) => grandparentChildren[grandparents.indexOf(grandparentId)] ?? []).filter((id) => id !== parentId)));
    for (const siblingId of parentSiblings) {
      const pairKey = [parentId, siblingId].sort().join(":");
      if (siblingSet.has(pairKey)) continue;
      siblingSet.add(pairKey);
      siblingEdges.push({ id: `sib-${pairKey}`, personAId: parentId, personBId: siblingId, type: "SIBLING", source: "AGRON 2006", confidence: "inferred-from-shared-parent" });
    }
  }
  return { people: Array.from(graph.people.values()), relationships: [...graph.relationships, ...siblingEdges] };
}
