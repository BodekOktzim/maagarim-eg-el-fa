import { readOfflineFile, readOfflineUrlRange } from "./offline-data";

const RECORD_BYTES = 16;
const MEDIA_ROOT = "https://media.githubusercontent.com/media/BodekOktzim/maagarim-eg-el-fa/main";
const INDEX_ROOT = MEDIA_ROOT;
const RAW_INDEX_ROOT = "https://raw.githubusercontent.com/BodekOktzim/maagarim-eg-el-fa/main";
const SEEK_ROOT = `${import.meta.env.BASE_URL}index-seek`;

type SourceKey = "agron2006" | "elector" | "facebook";

export type SourceFilter = "all" | SourceKey;

export type UnifiedQueryKind = "national-id" | "phone" | "facebook-id" | "age" | "text";

export type SearchHit = {
  source: string;
  sourceKey: SourceKey;
  confidence: "exact-id" | "candidate-id-field" | "phone-match" | "facebook-id-match" | "text-match" | "approximate-text-match";
  nationalId: string;
  fullName: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  phoneYear?: string;
  phoneCandidates?: string[];
  address?: string;
  addressYear?: string;
  previousAddress?: string;
  previousAddressYear?: string;
  city?: string;
  cityCode?: string;
  age?: string;
  birthDate?: string;
  maritalStatus?: string;
  fatherId?: string;
  motherId?: string;
  spouseId?: string;
  facebookId?: string;
  sourceNames?: string[];
};

export type TextSearchCriteria = {
  firstName?: string;
  lastName?: string;
  location?: string;
  city?: string;
  address?: string;
  age?: string;
};

export function parseAgeRange(value?: string) {
  const text = value?.trim();
  if (!text) return undefined;
  const match = text.match(/^(\d{1,3})(?:\s*[-–—]\s*(\d{1,3}))?$/);
  if (!match) throw new Error("הגיל צריך להיות מספר או טווח, לדוגמה 20 או 20-30.");
  const first = Number(match[1]);
  const second = match[2] ? Number(match[2]) : first;
  if (!Number.isInteger(first) || !Number.isInteger(second) || first < 1 || second > 120 || first > second) {
    throw new Error("יש להזין גיל בין 1 ל־120, או טווח תקין כמו 20-30.");
  }
  return { min: first, max: second };
}

export type TextMatchMode = "exact" | "similar";

export type FamilyTreePerson = {
  id: string;
  nationalId?: string;
  fullName: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  phoneYear?: string;
  address?: string;
  addressYear?: string;
  previousAddress?: string;
  previousAddressYear?: string;
  city?: string;
  birthDate?: string;
  age?: string;
  maritalStatus?: string;
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
  indexFiles?: string[];
  sparseFiles?: string[];
  indexBytesByFile?: number[];
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
const idSourceSearchCache = new Map<string, Promise<SearchHit[]>>();
const facebookPhoneCache = new Map<string, Promise<SearchHit[]>>();
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

export function classifyUnifiedQuery(input: string, sourceFilter: SourceFilter): UnifiedQueryKind {
  const value = input.trim();
  if (!value) return "text";
  if (/^(?:טלפון|phone)\s*[:#]?\s*/i.test(value)) return "phone";
  if (/^(?:fb|facebook|פייסבוק)(?:[\s-]*id)?[\s-]*[:#]?\s*\d{1,18}$/i.test(value)) return "facebook-id";
  if (/^(?:ת[.״׳"']?ז\.?|תעודת\s*זהות|id)\s*[:#]?\s*\d{5,9}$/i.test(value)) return "national-id";
  if (/^גיל\s*\d{1,3}(?:\s*[-–—]\s*\d{1,3})?$/i.test(value)) return "age";
  if (sourceFilter !== "facebook" && /^\d{1,3}(?:\s*[-–—]\s*\d{1,3})?$/.test(value)) return "age";

  const digits = digitsOnly(value);
  const numericInput = /^[+\d\s().-]+$/.test(value);
  if (!numericInput || !digits) return "text";

  let localPhone = digits;
  if (localPhone.startsWith("00972")) localPhone = `0${localPhone.slice(5)}`;
  else if (localPhone.startsWith("972")) localPhone = `0${localPhone.slice(3)}`;
  const looksIsraeliPhone = /^0[2-9]\d{7,8}$/.test(localPhone);
  const phoneFormatting = /[+()\s-]/.test(value);
  if (looksIsraeliPhone && (sourceFilter === "facebook" || localPhone.length === 10 || phoneFormatting || digits.startsWith("972") || digits.startsWith("00972"))) return "phone";

  if (sourceFilter === "facebook") return /^\d{1,18}$/.test(digits) ? "facebook-id" : "text";
  if (digits.length >= 5 && digits.length <= 9) return "national-id";
  if (digits.length === 10 && digits.startsWith("0")) return "phone";
  if (sourceFilter === "all" && digits.length >= 10 && digits.length <= 18) return "facebook-id";
  return "text";
}

function normalizeText(value: string) {
  return value.toLowerCase().replace(/[׳'".,]/g, "").replace(/\s+/g, " ").trim();
}

function normalizeFuzzyToken(value: string) {
  const finalLetters: Record<string, string> = { ך: "כ", ם: "מ", ן: "נ", ף: "פ", ץ: "צ" };
  return normalizeText(value).replace(/[ךםןףץ]/g, (letter) => finalLetters[letter] ?? letter);
}

function withinOneEdit(left: string, right: string) {
  if (left === right) return true;
  if (Math.abs(left.length - right.length) > 1 || Math.min(left.length, right.length) < 3) return false;
  let leftIndex = 0;
  let rightIndex = 0;
  let edits = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    if (left[leftIndex] === right[rightIndex]) {
      leftIndex += 1;
      rightIndex += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (left.length > right.length) leftIndex += 1;
    else if (right.length > left.length) rightIndex += 1;
    else { leftIndex += 1; rightIndex += 1; }
  }
  return edits + (leftIndex < left.length || rightIndex < right.length ? 1 : 0) <= 1;
}

function textValueMatches(value: string, term: string, matchMode: TextMatchMode) {
  const normalizedValue = normalizeText(value);
  const normalizedTerm = normalizeText(term);
  if (!normalizedTerm || normalizedValue.includes(normalizedTerm)) return true;
  if (matchMode !== "similar") return false;
  const queryWords = normalizeFuzzyToken(normalizedTerm).split(" ").filter(Boolean);
  const valueWords = normalizeFuzzyToken(normalizedValue).split(" ").filter(Boolean);
  if (!queryWords.length || queryWords.some((word) => word.length < 3)) return false;
  return valueWords.some((_, start) => start + queryWords.length <= valueWords.length
    && queryWords.every((word, index) => withinOneEdit(word, valueWords[start + index])));
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
  const offline = await readOfflineUrlRange(url, start, endInclusive);
  if (offline) return offline;
  const request = (target: string) => fetch(target, {
    headers: { Range: `bytes=${start}-${endInclusive}` },
    cache: "no-store",
    credentials: "omit",
  });
  let response = await request(url);
  if ((response.status === 404 || response.status === 416) && url.startsWith(`${MEDIA_ROOT}/`)) {
    response = await request(`${RAW_INDEX_ROOT}/${url.slice(MEDIA_ROOT.length + 1)}`);
  }
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
    sparseCache.set(url, (async () => {
      const offline = await readOfflineFile(`index-seek/${file}`);
      if (offline) return offline;
      const response = await fetch(url, { cache: "no-cache" });
      if (!response.ok) throw new Error(`לא ניתן לטעון את קובץ העזר ${file}.`);
      return response.arrayBuffer();
    })());
  }
  return sparseCache.get(url)!;
}

async function findSparseRange(meta: ExtensionIndex, target: number | bigint, keyBytes = 4, recordBytes = 16, sparseFile = meta.sparseFile, indexBytes = meta.indexBytes) {
  const buffer = await getSparse(sparseFile);
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
  const totalRecords = indexBytes / recordBytes;
  const endOrdinal = firstGreater < count ? read(view, firstGreater).ordinal : totalRecords;
  return { startOrdinal, endOrdinal, totalRecords };
}

async function readPostingGroup(meta: ExtensionIndex, key: number, cap: number, allowPartial = false) {
  const files = meta.indexFiles ?? [meta.indexFile];
  const sparseFiles = meta.sparseFiles ?? [meta.sparseFile];
  const bytes = meta.indexBytesByFile ?? [meta.indexBytes];
  const records: RowPointer[] = [];
  let totalCount = 0;
  for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
    const file = files[fileIndex];
    const range = await findSparseRange(meta, key, 4, 16, sparseFiles[fileIndex], bytes[fileIndex]);
    const count = range.endOrdinal - range.startOrdinal;
    if (count <= 0) continue;
    if (totalCount + count > cap && !allowPartial) throw new Error("נמצאו יותר מדי מועמדים לפי מפתח זה. הוסיפו שם משפחה, יישוב או גיל כדי לצמצם את החיפוש.");
    const sampledEnd = allowPartial ? Math.min(range.endOrdinal, range.startOrdinal + cap - totalCount) : range.endOrdinal;
    const buffer = await getByteRange(`${INDEX_ROOT}/search-index-full/${file}`, range.startOrdinal * 16, sampledEnd * 16 - 1, file);
    if (buffer.byteLength % 16) throw new Error(`טווח אינדקס פגום עבור ${file}.`);
    const view = new DataView(buffer);
    for (let byte = 0; byte < buffer.byteLength; byte += 16) {
      if (view.getUint32(byte, true) !== key) continue;
      records.push({ offset: Number(view.getBigUint64(byte + 4, true)), length: view.getUint32(byte + 12, true) });
    }
    totalCount += count;
    if (allowPartial && totalCount >= cap) break;
  }
  return { count: totalCount, records };
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
  const iso = value.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  const dmy = value.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (!iso && !dmy) return undefined;
  const birthYear = Number(iso ? iso[1] : dmy![3]);
  const birthMonth = Number(iso ? iso[2] : dmy![2]);
  const birthDay = Number(iso ? iso[3] : dmy![1]);
  const today = new Date();
  let age = today.getFullYear() - birthYear;
  const birthdayPassed = today.getMonth() + 1 > birthMonth || (today.getMonth() + 1 === birthMonth && today.getDate() >= birthDay);
  if (!birthdayPassed) age -= 1;
  return age >= 0 && age <= 130 ? String(age) : undefined;
}

export function formatBirthDate(value?: string) {
  if (!value) return undefined;
  const iso = value.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (iso) return `${iso[3].padStart(2, "0")}/${iso[2].padStart(2, "0")}/${iso[1]}`;
  const dmy = value.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (dmy) return `${dmy[1].padStart(2, "0")}/${dmy[2].padStart(2, "0")}/${dmy[3]}`;
  return value;
}

function normalizeFacebookStatus(value: string | undefined, gender: string | undefined) {
  const status = value?.trim();
  if (!status) return undefined;
  const key = status.toLowerCase().replace(/\s+/g, " ");
  const female = /^(female|f)$/i.test(gender?.trim() ?? "");
  const translations: Record<string, [string, string]> = {
    single: ["רווק", "רווקה"],
    married: ["נשוי", "נשואה"],
    divorced: ["גרוש", "גרושה"],
    widowed: ["אלמן", "אלמנה"],
    engaged: ["מאורס", "מאורסת"],
    "in a relationship": ["בזוגיות", "בזוגיות"],
    "it's complicated": ["המצב מורכב", "המצב מורכב"],
    "in an open relationship": ["בזוגיות פתוחה", "בזוגיות פתוחה"],
  };
  const translated = translations[key];
  return translated ? translated[female ? 1 : 0] : status;
}

export function parseFacebookHit(line: string, target = ""): SearchHit | null {
  const fields = line.replace(/[\r\n]+$/, "").split(":");
  if (fields.length < 5) return null;
  const firstName = fields[2] ?? "";
  const lastName = fields[3] ?? "";
  return {
    source: "Facebook (התאמה אפשרית)", sourceKey: "facebook", confidence: "candidate-id-field", nationalId: target,
    firstName, lastName, fullName: [firstName, lastName].filter(Boolean).join(" ") || "רשומת Facebook",
    phone: fields[0] || undefined, facebookId: fields[1] || undefined,
    maritalStatus: normalizeFacebookStatus(fields[7], fields[4]),
  };
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
      phone: fields[13] || undefined, address: address || undefined, city: fields[11] || undefined, age: (currentAgeFromBirthDate(fields[15]) ?? fields[14]) || undefined, birthDate: formatBirthDate(fields[15]),
      fatherId: displayId(fields[20]), motherId: displayId(fields[22]), spouseId: displayId(fields[23]),
    };
  }
  if (source.key === "elector") {
    const firstName = fields[1] ?? "";
    const lastName = fields[2] ?? "";
    return {
      source: "Elector", sourceKey: source.key, confidence: "exact-id", nationalId: displayId(fields[3]) ?? target,
      firstName, lastName, fullName: [firstName, lastName].filter(Boolean).join(" ") || "ללא שם בקובץ",
      phone: fields[4] || undefined, address: fields.slice(5, 8).filter(Boolean).join(", ") || undefined, cityCode: fields[9] || undefined,
    };
  }
  return parseFacebookHit(line, target);
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
      sourceNames: Array.from(new Set(group.flatMap((hit) => hit.sourceNames ?? [hit.source]))),
      firstName: pick("firstName") ?? family.firstName,
      lastName: pick("lastName") ?? family.lastName,
      fullName: [pick("firstName") ?? family.firstName, pick("lastName") ?? family.lastName].filter(Boolean).join(" ") || family.fullName,
      phone: pick("phone"),
      phoneYear: pick("phoneYear") ?? (elector?.phone ? "2020" : agron?.phone ? "2006" : undefined),
      phoneCandidates: Array.from(new Set(group.flatMap((hit) => hit.phoneCandidates ?? (hit.phone ? [hit.phone] : [])))),
      address: pick("address"),
      addressYear: pick("addressYear") ?? (elector?.address ? "2020" : agron?.address ? "2006" : undefined),
      previousAddress: pick("previousAddress") ?? (elector?.address && agron?.address ? agron.address : undefined),
      previousAddressYear: pick("previousAddressYear") ?? (elector?.address && agron?.address ? "2006" : undefined),
      city: pick("city"),
      age: pick("age"),
      birthDate: pick("birthDate"),
      maritalStatus: pick("maritalStatus"),
      facebookId: pick("facebookId"),
      fatherId: agron?.fatherId ?? family.fatherId,
      motherId: agron?.motherId ?? family.motherId,
      spouseId: agron?.spouseId ?? family.spouseId,
    };
  });
}

export function keepSelectedSource(hits: SearchHit[], sourceFilter: SourceFilter) {
  if (sourceFilter === "all") return hits;
  const sourceLabel = sourceFilter === "agron2006" ? "AGRON 2006" : sourceFilter === "elector" ? "Elector" : "Facebook";
  return hits.filter((hit) => hit.sourceKey === sourceFilter).map((hit) => ({ ...hit, source: sourceLabel, sourceNames: [sourceLabel] }));
}

export function mergePhoneHits(hits: SearchHit[]): SearchHit[] {
  const primary = mergeHits(hits.filter((hit) => hit.sourceKey !== "facebook"));
  const facebook = hits.filter((hit) => hit.sourceKey === "facebook");
  const uniqueFacebook = Array.from(new Map(facebook.map((hit) => [`${hit.facebookId ?? ""}:${hit.nationalId}:${hit.fullName}`, hit])).values());
  return applyFacebookDetails([...primary, ...uniqueFacebook], facebook);
}

async function fetchSourceRow(source: IndexSource, record: RowPointer, target: string) {
  const cacheKey = `${source.key}:${record.offset}:${record.length}`;
  if (!rowCache.has(cacheKey)) {
    rowCache.set(cacheKey, getByteRange(`${MEDIA_ROOT}/datasets/${encodeURIComponent(source.file)}`, record.offset, record.offset + record.length - 1, source.file)
      .then((buffer) => parseHit(source, new TextDecoder("utf-8", { fatal: false }).decode(buffer), target)));
  }
  return rowCache.get(cacheKey)!;
}

async function searchSourceById(source: IndexSource, normalized: string, blockRecords: number): Promise<SearchHit[]> {
  const cacheKey = `${source.key}:${normalized}`;
  if (!idSourceSearchCache.has(cacheKey)) {
    idSourceSearchCache.set(cacheKey, (async () => {
      const targetId = Number(normalized);
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
    })());
  }
  return idSourceSearchCache.get(cacheKey)!;
}

export async function searchFullDatasetsById(input: string, sourceFilter: SourceFilter = "all"): Promise<SearchHit[]> {
  const normalized = normalizeId(input);
  const cacheKey = `${sourceFilter}:${normalized}`;
  if (!idSearchCache.has(cacheKey)) {
    idSearchCache.set(cacheKey, (async () => {
      const manifest = await getManifest();
      const blockRecords = manifest.blockRecords || 4096;
      // Facebook's numeric key is a Facebook profile ID, not an Israeli national ID.
      const sources = manifest.sources.filter((source) => source.key !== "facebook" && (sourceFilter === "all" || source.key === sourceFilter));
      const results = await Promise.all(sources.map((source) => searchSourceById(source, normalized, blockRecords)));
      const hits = results.flat();
      return sourceFilter === "all" ? mergeHits(hits) : keepSelectedSource(hits, sourceFilter);
    })());
  }
  return idSearchCache.get(cacheKey)!;
}

export async function searchFullDatasetsByIdWithDetails(input: string, sourceFilter: SourceFilter = "all"): Promise<SearchHit[]> {
  const hits = await searchFullDatasetsById(input, sourceFilter);
  return sourceFilter === "all" ? attachFacebookMaritalStatus(hits) : hits;
}

function criteriaForSource(criteria: TextSearchCriteria, sourceKey: SourceKey) {
  const output: { indexKey: string; field: keyof TextSearchCriteria; value: string }[] = [];
  if (criteria.firstName?.trim()) {
    const indexKey = sourceKey === "agron2006" ? "text-agron-first" : sourceKey === "elector" ? "text-elector-first" : "text-facebook-first-candidate";
    output.push({ indexKey, field: "firstName", value: criteria.firstName.trim() });
  }
  if (criteria.lastName?.trim()) {
    const indexKey = sourceKey === "agron2006" ? "text-agron-last" : sourceKey === "elector" ? "text-elector-last" : "text-facebook-last-candidate";
    output.push({ indexKey, field: "lastName", value: criteria.lastName.trim() });
  }
  if (criteria.location?.trim()) {
    if (sourceKey === "agron2006") {
      output.push({ indexKey: "text-agron-city", field: "location", value: criteria.location.trim() });
      output.push({ indexKey: "text-agron-address", field: "location", value: criteria.location.trim() });
    } else if (sourceKey === "elector") {
      output.push({ indexKey: "text-elector-address", field: "location", value: criteria.location.trim() });
    }
  }
  if (criteria.city?.trim() && sourceKey === "agron2006") output.push({ indexKey: "text-agron-city", field: "city", value: criteria.city.trim() });
  if (criteria.address?.trim()) {
    const indexKey = sourceKey === "agron2006" ? "text-agron-address" : sourceKey === "elector" ? "text-elector-address" : "";
    if (indexKey) output.push({ indexKey, field: "address", value: criteria.address.trim() });
  }
  return output;
}

function textMatches(hit: SearchHit, criteria: TextSearchCriteria, matchMode: TextMatchMode = "exact") {
  for (const field of ["firstName", "lastName", "city", "address"] as const) {
    const term = criteria[field]?.trim();
    if (term && !textValueMatches(String(hit[field] ?? ""), term, matchMode)) return false;
  }
  const location = criteria.location?.trim();
  if (location && ![hit.city, hit.address].some((value) => value && textValueMatches(value, location, matchMode))) return false;
  const ageRange = parseAgeRange(criteria.age);
  if (ageRange) {
    const age = Number(hit.age);
    if (!Number.isInteger(age) || age < ageRange.min || age > ageRange.max) return false;
  }
  return true;
}

export function textMatchesWithinSource(hit: SearchHit, criteria: TextSearchCriteria, matchMode: TextMatchMode = "exact") {
  // City names are indexed only in AGRON. Keep Elector candidates by name until
  // after merging, when the AGRON city can be checked against the unified hit.
  const sourceCriteria = hit.sourceKey === "elector" ? { ...criteria, city: undefined } : criteria;
  return textMatches(hit, sourceCriteria, matchMode);
}

export function mergeTextSearchHits(hits: SearchHit[], criteria: TextSearchCriteria, matchMode: TextMatchMode = "exact") {
  const groups = new Map<string, SearchHit[]>();
  for (const hit of hits) {
    const key = displayId(hit.nationalId) ?? hit.facebookId ?? `${hit.sourceKey}:${hit.fullName}:${hit.phone ?? ""}`;
    const group = groups.get(key) ?? [];
    group.push(hit);
    groups.set(key, group);
  }
  const withoutCity = { ...criteria, city: undefined };
  const eligible: { key: string; hits: SearchHit[]; approximate: boolean }[] = [];
  groups.forEach((group, key) => {
    const nameAndAgeMatch = group.some((hit) => textMatches(hit, withoutCity, matchMode));
    const exactNameAndAgeMatch = group.some((hit) => textMatches(hit, withoutCity, "exact"));
    // A person can have different cities in AGRON (2006) and Elector (2020).
    // Match the requested city against either historical source before merging.
    const cityMatch = !criteria.city?.trim() || group.some((hit) => textMatches(hit, { city: criteria.city }, matchMode));
    const exactCityMatch = !criteria.city?.trim() || group.some((hit) => textMatches(hit, { city: criteria.city }, "exact"));
    const locationMatch = !criteria.location?.trim() || group.some((hit) => textMatches(hit, { location: criteria.location }, matchMode));
    const exactLocationMatch = !criteria.location?.trim() || group.some((hit) => textMatches(hit, { location: criteria.location }, "exact"));
    if (nameAndAgeMatch && cityMatch && locationMatch) eligible.push({ key, hits: group, approximate: !exactNameAndAgeMatch || !exactCityMatch || !exactLocationMatch });
  });
  const approximateKeys = new Set(eligible.filter((group) => group.approximate).map((group) => group.key));
  const merged = mergeHits(eligible.flatMap((group) => group.hits)).slice(0, 250);
  return merged.map((hit) => {
    const key = displayId(hit.nationalId) ?? hit.facebookId ?? `${hit.sourceKey}:${hit.fullName}:${hit.phone ?? ""}`;
    return approximateKeys.has(key) ? { ...hit, confidence: "approximate-text-match" as const } : hit;
  });
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

async function searchTextInSource(source: IndexSource, criteria: TextSearchCriteria, extensions: ExtensionManifest, matchMode: TextMatchMode) {
  if (criteria.age && source.key !== "agron2006") return [] as SearchHit[];
  if ((criteria.address || criteria.location) && source.key === "facebook") return [] as SearchHit[];
  const ageRange = parseAgeRange(criteria.age);
  const criteriaItems = criteriaForSource(criteria, source.key);
  const candidates: { meta: ExtensionIndex; key: number; value: string; field: keyof TextSearchCriteria; count: number }[] = [];
  for (const criterion of criteriaItems) {
    const grams = bigrams(matchMode === "similar" ? normalizeFuzzyToken(criterion.value) : criterion.value);
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
  if (ageRange && source.key === "agron2006") {
    const meta = extensions.indexes["age-agron"];
    if (meta) {
      for (let key = ageRange.min; key <= ageRange.max; key += 1) {
        const range = await findSparseRange(meta, key, 4, 16);
        const count = Math.max(0, range.endOrdinal - range.startOrdinal);
        if (count) candidates.push({ meta, key, value: String(key), field: "age", count });
      }
    }
  }
  if (!candidates.length) return [] as SearchHit[];
  const selectedCandidates = (["firstName", "lastName", "city", "address", "location", "age"] as const).flatMap((field) => {
    const fieldCandidates = candidates.filter((candidate) => candidate.field === field).sort((left, right) => left.count - right.count);
    if (field === "location") {
      const byIndex = new Map<string, typeof fieldCandidates>();
      for (const candidate of fieldCandidates) {
        const indexKey = `${candidate.meta.source}:${candidate.meta.indexFiles?.join(",") ?? candidate.meta.indexFile}`;
        const list = byIndex.get(indexKey) ?? [];
        list.push(candidate);
        byIndex.set(indexKey, list);
      }
      return Array.from(byIndex.values()).flatMap((items) => items.slice(0, matchMode === "similar" ? 4 : 1));
    }
    return fieldCandidates.slice(0, matchMode === "similar" ? (field === "age" ? 120 : 4) : (field === "age" ? 120 : 1));
  });
  const pointerScores = new Map<number, { pointer: RowPointer; score: number; order: number }>();
  const postingGroups = await Promise.all(selectedCandidates.map((candidate) =>
    readPostingGroup(candidate.meta, candidate.key, matchMode === "similar" ? 10_000 : 300_000, true)));
  for (let order = 0; order < postingGroups.length; order += 1) {
    const group = postingGroups[order];
    for (const pointer of group.records) {
      const current = pointerScores.get(pointer.offset);
      if (current) current.score += 1;
      else pointerScores.set(pointer.offset, { pointer, score: 1, order });
    }
  }
  const rowLimit = matchMode === "similar" ? 1_000 : 400;
  const pointers = Array.from(pointerScores.values())
    .sort((left, right) => right.score - left.score || left.order - right.order)
    .slice(0, rowLimit)
    .map(({ pointer }) => pointer);
  const hits = await mapLimit(pointers, 16, (pointer) => fetchSourceRow(source, pointer, ""));
  return hits.filter((hit): hit is SearchHit => Boolean(hit && textMatchesWithinSource(hit, criteria, matchMode)));
}

export async function searchFullDatasetsByText(criteria: TextSearchCriteria, matchMode: TextMatchMode = "exact", sourceFilter: SourceFilter = "all") {
  const hasText = Boolean(criteria.firstName?.trim() || criteria.lastName?.trim() || criteria.location?.trim() || criteria.city?.trim() || criteria.address?.trim());
  const age = criteria.age?.trim() ?? "";
  if (!hasText && !age) throw new Error("יש למלא לפחות שדה חיפוש אחד.");
  if (age) parseAgeRange(age);
  for (const value of [criteria.firstName, criteria.lastName, criteria.location, criteria.city, criteria.address]) {
    if (value?.trim() && normalizeText(value).length < 2) throw new Error("בחיפוש לפי שם או יישוב יש להזין לפחות שתי אותיות.");
  }
  const [manifest, extensions] = await Promise.all([getManifest(), getExtensionManifest()]);
  const hits = await Promise.all(manifest.sources.filter((source) => sourceFilter === "all" || source.key === sourceFilter).map((source) => searchTextInSource(source, criteria, extensions, matchMode)));
  const allHits = hits.flat();
  const merged = mergeTextSearchHits(allHits, criteria, matchMode);
  return sourceFilter === "all"
    ? applyFacebookDetails(merged, allHits.filter((hit) => hit.sourceKey === "facebook"))
    : keepSelectedSource(merged, sourceFilter);
}

export async function searchUnifiedQuery(input: string, sourceFilter: SourceFilter = "all", matchMode: TextMatchMode = "exact") {
  const query = input.trim();
  if (!query) throw new Error("יש להזין ערך לחיפוש.");
  const kind = classifyUnifiedQuery(query, sourceFilter);
  if (kind === "national-id") {
    if (sourceFilter === "facebook") throw new Error("תעודת זהות זמינה לחיפוש באגרון, באלקטור או בכל המקורות; Facebook תומך בשם, טלפון או מזהה Facebook.");
    return searchFullDatasetsByIdWithDetails(query.replace(/^(?:ת[.״׳"']?ז\.?|תעודת\s*זהות|id)\s*[:#]?\s*/i, "").replace(/\D/g, ""), sourceFilter);
  }
  if (kind === "phone") return searchFullDatasetsByPhone(query.replace(/^(?:טלפון|phone)\s*[:#]?\s*/i, ""), sourceFilter);
  if (kind === "facebook-id") {
    if (sourceFilter !== "all" && sourceFilter !== "facebook") throw new Error("מזהה Facebook זמין רק במקור Facebook או בבחירה „הכול”.");
    const value = query.match(/(\d{1,18})\s*$/)?.[1] ?? query;
    return searchFullDatasetsByFacebookId(value, sourceFilter);
  }
  if (kind === "age") {
    const age = query.replace(/^גיל\s*/i, "").trim();
    parseAgeRange(age);
    return searchFullDatasetsByText({ age }, matchMode, sourceFilter);
  }

  const words = query.split(/\s+/).filter(Boolean);
  const searches = words.length === 1
    ? [
      searchFullDatasetsByText({ firstName: query }, matchMode, sourceFilter),
      searchFullDatasetsByText({ lastName: query }, matchMode, sourceFilter),
      searchFullDatasetsByText({ city: query }, matchMode, sourceFilter),
      searchFullDatasetsByText({ address: query }, matchMode, sourceFilter),
    ]
    : [
      searchFullDatasetsByText({ firstName: words[0], lastName: words.slice(1).join(" ") }, matchMode, sourceFilter),
      searchFullDatasetsByText({ firstName: words[0], lastName: words[1] }, matchMode, sourceFilter),
      searchFullDatasetsByText({ city: query }, matchMode, sourceFilter),
      searchFullDatasetsByText({ address: query }, matchMode, sourceFilter),
      ...(words.length > 2 ? [
        searchFullDatasetsByText({ firstName: words[0], lastName: words[1], city: words.slice(2).join(" ") }, matchMode, sourceFilter),
        searchFullDatasetsByText({ city: words.slice(2).join(" ") }, matchMode, sourceFilter),
      ] : []),
    ];
  return mergeHits((await Promise.all(searches)).flat());
}

function phoneMatches(hit: SearchHit, phone: string) {
  if (!hit.phone) return false;
  try { return normalizedPhone(hit.phone) === phone; } catch { return false; }
}

function samePersonName(first: SearchHit, second: SearchHit) {
  return Boolean(first.firstName && first.lastName && second.firstName && second.lastName)
    && normalizeText(first.firstName!) === normalizeText(second.firstName!)
    && normalizeText(first.lastName!) === normalizeText(second.lastName!);
}

export function applyFacebookDetails(hits: SearchHit[], facebookHits: SearchHit[]) {
  return hits.map((hit) => {
    if (hit.sourceKey === "facebook" || hit.maritalStatus || (!hit.phone && !hit.phoneCandidates?.length)) return hit;
    const phones = Array.from(new Set((hit.phoneCandidates ?? (hit.phone ? [hit.phone] : [])).flatMap((value) => {
      try { return [normalizedPhone(value)]; } catch { return []; }
    })));
    const match = facebookHits.find((facebook) => facebook.sourceKey === "facebook" && facebook.maritalStatus
      && phones.some((phone) => phoneMatches(facebook, phone)) && samePersonName(hit, facebook));
    return match ? { ...hit, maritalStatus: match.maritalStatus } : hit;
  });
}

async function searchFacebookByPhone(input: string) {
  const phone = normalizedPhone(input);
  if (!facebookPhoneCache.has(phone)) {
    facebookPhoneCache.set(phone, (async () => {
      try {
        const [manifest, extensions] = await Promise.all([getManifest(), getExtensionManifest()]);
        const source = manifest.sources.find((item) => item.key === "facebook");
        const meta = extensions.indexes["phone-facebook-candidate"];
        if (!source || !meta) return [] as SearchHit[];
        const group = await readPostingGroup(meta, hash32(phone), 20_000);
        const pointers = group.records.slice(0, 500);
        const hits = await Promise.all(pointers.map((pointer) => fetchSourceRow(source, pointer, "")));
        return hits.filter((hit): hit is SearchHit => Boolean(hit && phoneMatches(hit, phone)));
      } catch {
        return [] as SearchHit[];
      }
    })());
  }
  return facebookPhoneCache.get(phone)!;
}

async function attachFacebookMaritalStatus(hits: SearchHit[]) {
  const phones = Array.from(new Set(hits.filter((hit) => hit.sourceKey !== "facebook" && (hit.phone || hit.phoneCandidates?.length) && hit.firstName && hit.lastName)
    .flatMap((hit) => (hit.phoneCandidates ?? (hit.phone ? [hit.phone] : [])).flatMap((value) => { try { return [normalizedPhone(value)]; } catch { return []; } }))));
  if (!phones.length) return hits;
  const facebookHits = (await mapLimit(phones, 8, searchFacebookByPhone)).flat();
  return applyFacebookDetails(hits, facebookHits);
}

export async function searchFullDatasetsByPhone(input: string, sourceFilter: SourceFilter = "all") {
  const phone = normalizedPhone(input);
  const [manifest, extensions] = await Promise.all([getManifest(), getExtensionManifest()]);
  const all = await Promise.all(manifest.sources.filter((source) => sourceFilter === "all" || source.key === sourceFilter).map(async (source) => {
    const key = source.key === "agron2006" ? "phone-agron" : source.key === "elector" ? "phone-elector" : "phone-facebook-candidate";
    const meta = extensions.indexes[key];
    if (!meta) return [] as SearchHit[];
    const group = await readPostingGroup(meta, hash32(phone), 20_000);
    const pointers = group.records.slice(0, 500);
    const hits = await Promise.all(pointers.map((pointer) => fetchSourceRow(source, pointer, "")));
    return hits.filter((hit): hit is SearchHit => Boolean(hit && phoneMatches(hit, phone))).map((hit) => ({ ...hit, confidence: "phone-match" as const }));
  }));
  return sourceFilter === "all" ? mergePhoneHits(all.flat()) : keepSelectedSource(all.flat(), sourceFilter);
}

export async function searchFullDatasetsByFacebookId(input: string, sourceFilter: SourceFilter = "all") {
  if (sourceFilter !== "all" && sourceFilter !== "facebook") return [];
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

export function toFamilyTreePerson(id: string, hits: SearchHit[]): FamilyTreePerson {
  const primary = mergeHits(hits)[0] ?? hits[0];
  if (!primary) return { id, nationalId: id, fullName: "לא נמצאה רשומה במקורות" };
  return {
    id, nationalId: primary.nationalId, fullName: primary.fullName, firstName: primary.firstName, lastName: primary.lastName,
    phone: primary.phone, phoneYear: primary.phoneYear, address: primary.address, addressYear: primary.addressYear,
    previousAddress: primary.previousAddress, previousAddressYear: primary.previousAddressYear,
    city: primary.city, birthDate: primary.birthDate, age: primary.age, maritalStatus: primary.maritalStatus,
    sourceNames: primary.sourceNames ?? Array.from(new Set(hits.map((hit) => hit.source))),
  };
}

async function getPeople(ids: string[]) {
  const unique = Array.from(new Set(ids.map((id) => displayId(id) ?? "").filter(Boolean))).slice(0, 120);
  const results = await Promise.all(unique.map(async (id) => {
    const hits = await searchFullDatasetsById(id);
    return { id, hits };
  }));
  const enrichedHits = await attachFacebookMaritalStatus(results.map(({ hits }) => mergeHits(hits)[0]).filter((hit): hit is SearchHit => Boolean(hit)));
  const detailById = new Map(enrichedHits.map((hit) => [displayId(hit.nationalId) ?? "", hit]));
  const people = new Map<string, FamilyTreePerson>();
  const relationships: FamilyTreeRelationship[] = [];
  for (const { id, hits } of results) {
    const agron = hits.find((hit) => hit.sourceKey === "agron2006");
    const primary = detailById.get(displayId(id) ?? "") ?? mergeHits(hits)[0] ?? hits.find((hit) => hit.sourceKey === "elector") ?? hits[0];
    people.set(id, toFamilyTreePerson(id, primary ? [primary] : hits));
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
