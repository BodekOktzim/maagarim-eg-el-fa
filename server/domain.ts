export type Confidence = "VERIFIED" | "HIGH_CONFIDENCE" | "POSSIBLE" | "CONFLICT" | "UNKNOWN";
export type RelationshipType = "PARENT" | "CHILD" | "SIBLING";
export type SearchType = "national_id" | "phone" | "name" | "address" | "name_address";

export type SyntheticRecord = {
  source: string;
  externalId: string;
  nationalId?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  address?: string;
  birthDate?: string;
  fatherNationalId?: string;
  motherNationalId?: string;
  payload: Record<string, unknown>;
};

export type Person = {
  id: string;
  nationalId?: string;
  firstName: string;
  lastName: string;
  fullName: string;
  phone?: string;
  address?: string;
  birthDate?: string;
  sourceNames: string[];
  rawRecordIds: string[];
};

export type Relationship = {
  id: string;
  personAId: string;
  personBId: string;
  type: RelationshipType;
  confidence: Confidence;
  evidence: Record<string, unknown>;
  source: string;
};

export const normalizeNationalId = (value: string) => value.replace(/\D/g, "").padStart(9, "0").slice(-9);
export const normalizePhone = (value: string) => {
  const digits = value.replace(/\D/g, "");
  if (digits.startsWith("00")) return digits.slice(2);
  if (digits.startsWith("0")) return `972${digits.slice(1)}`;
  return digits;
};
export const normalizeText = (value: string) => value.trim().toLocaleLowerCase("he").replace(/[׳'".,]/g, "").replace(/\s+/g, " ");
export const normalizeAddress = (value: string) => normalizeText(value).replace(/^רחוב\s+/, "");

export const demoRecords: SyntheticRecord[] = [
  { source: "DB_2006", externalId: "2006-001", nationalId: "100000001", firstName: "אבי", lastName: "כהן", phone: "050-1111111", address: "הרצל 10", birthDate: "1955-03-12", payload: { tz: "100000001", fname: "אבי", lname: "כהן", phone: "050-1111111", address: "הרצל 10" } },
  { source: "DB_2006", externalId: "2006-002", nationalId: "100000002", firstName: "דינה", lastName: "כהן", phone: "050-2222222", address: "הרצל 10", birthDate: "1958-07-04", payload: { tz: "100000002", fname: "דינה", lname: "כהן", phone: "050-2222222", address: "הרצל 10" } },
  { source: "DB_2020", externalId: "2020-001", nationalId: "100000003", firstName: "יוסי", lastName: "כהן", phone: "0501234567", address: "רחוב הרצל 10", birthDate: "1985-02-10", fatherNationalId: "100000001", motherNationalId: "100000002", payload: { tz: "100000003", fname: "יוסי", lname: "כהן", father_tz: "100000001", mother_tz: "100000002" } },
  { source: "DB_2020", externalId: "2020-002", nationalId: "100000004", firstName: "משה", lastName: "כהן", phone: "050-4444444", address: "הרצל 10", birthDate: "1987-09-21", fatherNationalId: "100000001", motherNationalId: "100000002", payload: { tz: "100000004", fname: "משה", lname: "כהן", father_tz: "100000001", mother_tz: "100000002" } },
  { source: "FACEBOOK_DEMO", externalId: "fb-003", nationalId: "100000005", firstName: "גבי", lastName: "כהן", phone: "+972501234568", address: "הרצל 10 דירה 2", birthDate: "1990-01-30", fatherNationalId: "100000001", motherNationalId: "100000002", payload: { id: "fb-003", name: "גבי כהן", phone: "+972501234568", father_id: "100000001", mother_id: "100000002" } },
  { source: "DB_2020", externalId: "2020-003", nationalId: "100000006", firstName: "נועה", lastName: "לוי", phone: "050-9999999", address: "הנביאים 4", birthDate: "1988-11-11", fatherNationalId: "100000007", motherNationalId: "100000008", payload: { tz: "100000006", fname: "נועה", lname: "לוי", father_tz: "100000007", mother_tz: "100000008" } },
];

export function buildIndex(records = demoRecords) {
  const byNationalId = new Map<string, Person>();
  const people: Person[] = [];
  const rawRecords = records.map((record, index) => ({ ...record, id: `${record.source}:${record.externalId}:${index}` }));
  for (const record of rawRecords) {
    const nid = record.nationalId ? normalizeNationalId(record.nationalId) : undefined;
    let person = nid ? byNationalId.get(nid) : undefined;
    if (!person) {
      person = { id: `person-${nid ?? people.length + 1}`, nationalId: nid, firstName: record.firstName ?? "", lastName: record.lastName ?? "", fullName: `${record.firstName ?? ""} ${record.lastName ?? ""}`.trim(), phone: record.phone ? normalizePhone(record.phone) : undefined, address: record.address ? normalizeAddress(record.address) : undefined, birthDate: record.birthDate, sourceNames: [], rawRecordIds: [] };
      people.push(person);
      if (nid) byNationalId.set(nid, person);
    }
    if (!person.sourceNames.includes(record.source)) person.sourceNames.push(record.source);
    person.rawRecordIds.push(record.id);
  }
  const relationships: Relationship[] = [];
  const add = (a: Person, b: Person, type: RelationshipType, evidence: Record<string, unknown>, source: string) => {
    const id = `${type}:${a.id}:${b.id}`;
    if (!relationships.some((r) => r.id === id)) relationships.push({ id, personAId: a.id, personBId: b.id, type, confidence: "VERIFIED", evidence, source });
  };
  for (const record of rawRecords) {
    const child = record.nationalId ? byNationalId.get(normalizeNationalId(record.nationalId)) : undefined;
    if (!child) continue;
    for (const [kind, parentId] of [["father", record.fatherNationalId], ["mother", record.motherNationalId]] as const) {
      const parent = parentId ? byNationalId.get(normalizeNationalId(parentId)) : undefined;
      if (parent) add(child, parent, "PARENT", { method: "EXACT_PARENT_ID", field: kind, parentNationalId: parent.nationalId, childNationalId: child.nationalId }, record.source);
    }
  }
  const childrenByParent = new Map<string, Person[]>();
  for (const rel of relationships.filter((r) => r.type === "PARENT")) {
    const list = childrenByParent.get(rel.personBId) ?? []; list.push(people.find((p) => p.id === rel.personAId)!); childrenByParent.set(rel.personBId, list);
  }
  for (const siblings of Array.from(childrenByParent.values())) for (const a of siblings) for (const b of siblings) if (a.id < b.id) add(a, b, "SIBLING", { method: "SHARED_PARENT_IDS", sharedParentId: siblings.length ? relationships.find((r) => r.personAId === a.id && r.type === "PARENT")?.personBId : undefined }, "DB_2020");
  return { people, rawRecords, relationships, byNationalId };
}

export function searchIndex(index: ReturnType<typeof buildIndex>, query: string, type: SearchType, page = 1, pageSize = 20) {
  const [nameQuery, addressQuery] = query.split("|").map((part) => part.trim());
  const q = type === "national_id" ? normalizeNationalId(query) : type === "phone" ? normalizePhone(query) : type === "address" ? normalizeAddress(query) : normalizeText(query);
  const matching = index.people.filter((p) => type === "national_id" ? p.nationalId === q : type === "phone" ? p.phone === q : type === "address" ? p.address?.includes(q) : type === "name_address" ? normalizeText(p.fullName).includes(normalizeText(nameQuery ?? "")) && p.address?.includes(normalizeAddress(addressQuery ?? "")) : normalizeText(p.fullName).includes(q));
  return { items: matching.slice((page - 1) * pageSize, page * pageSize), total: matching.length, page, pageSize };
}

export function familyFor(index: ReturnType<typeof buildIndex>, personId: string, depth = 1) {
  const seen = new Set([personId]); const queue = [{ id: personId, level: 0 }];
  while (queue.length) { const current = queue.shift()!; if (current.level >= Math.max(0, Math.min(depth, 3))) continue; for (const r of index.relationships) { const next = r.personAId === current.id ? r.personBId : r.personBId === current.id ? r.personAId : undefined; if (next && !seen.has(next)) { seen.add(next); queue.push({ id: next, level: current.level + 1 }); } } }
  return { people: index.people.filter((p) => seen.has(p.id)), relationships: index.relationships.filter((r) => seen.has(r.personAId) && seen.has(r.personBId)) };
}

export interface DataSourceAdapter { searchByPhone(phone: string): Person[]; searchByName(name: string): Person[]; getRecord(id: string): SyntheticRecord | null; }
export class DatabaseAdapter implements DataSourceAdapter { constructor(private readonly index: ReturnType<typeof buildIndex>) {} searchByPhone(phone: string) { return searchIndex(this.index, phone, "phone").items; } searchByName(name: string) { return searchIndex(this.index, name, "name").items; } getRecord(id: string) { return this.index.rawRecords.find((r) => r.id === id) ?? null; } }
export class FacebookDemoAdapter extends DatabaseAdapter {}
export class TruecallerAdapter implements DataSourceAdapter { searchByPhone() { return []; } searchByName() { return []; } getRecord() { return null; } }

export async function* streamRecords(records: SyntheticRecord[], batchSize = 2) { for (let offset = 0; offset < records.length; offset += batchSize) yield records.slice(offset, offset + batchSize); }
