import type { Confidence, SyntheticRecord } from "./domain";
import { buildIndex, normalizeAddress, normalizePhone } from "./domain";

export type ExtendedRelationshipType = "GRANDPARENT" | "GRANDCHILD" | "UNCLE_AUNT" | "NIECE_NEPHEW" | "COUSIN";
export type ExtendedRelationship = { id: string; personAId: string; personBId: string; type: ExtendedRelationshipType; confidence: Confidence; evidence: Record<string, unknown>; source: string };
export type Conflict = { personId: string; field: string; status: "REQUIRES_REVIEW"; valuesBySource: Record<string, string[]> };

export function detectConflicts(records: SyntheticRecord[], index = buildIndex(records)): Conflict[] {
  const result: Conflict[] = [];
  for (const person of index.people) {
    const owned = index.rawRecords.filter((r) => person.rawRecordIds.includes(r.id));
    for (const field of ["firstName", "lastName", "phone", "address", "birthDate"] as const) {
      const values: Record<string, string[]> = {};
      for (const record of owned) {
        const raw = record[field];
        if (raw == null || raw === "") continue;
        const normalized = field === "phone" ? normalizePhone(String(raw)) : field === "address" ? normalizeAddress(String(raw)) : String(raw).trim().toLocaleLowerCase("he");
        values[record.source] ??= [];
        if (!values[record.source].includes(normalized)) values[record.source].push(normalized);
      }
      const distinct = Array.from(new Set(Object.values(values).flat()));
      if (distinct.length > 1) result.push({ personId: person.id, field, status: "REQUIRES_REVIEW", valuesBySource: values });
    }
  }
  return result;
}

function parentsOf(index: ReturnType<typeof buildIndex>, id: string) { return index.relationships.filter((r) => r.type === "PARENT" && r.personAId === id).map((r) => r.personBId); }
function childrenOf(index: ReturnType<typeof buildIndex>, id: string) { return index.relationships.filter((r) => r.type === "PARENT" && r.personBId === id).map((r) => r.personAId); }
function siblingsOf(index: ReturnType<typeof buildIndex>, id: string) { return index.relationships.filter((r) => r.type === "SIBLING" && (r.personAId === id || r.personBId === id)).map((r) => r.personAId === id ? r.personBId : r.personAId); }

export function extendedRelationships(index: ReturnType<typeof buildIndex>): ExtendedRelationship[] {
  const output: ExtendedRelationship[] = [];
  const add = (a: string, b: string, type: ExtendedRelationshipType, evidence: Record<string, unknown>) => { if (a === b) return; const id = `${type}:${a}:${b}`; if (!output.some((r) => r.id === id || (r.id === `${type}:${b}:${a}`))) output.push({ id, personAId: a, personBId: b, type, confidence: "VERIFIED", evidence, source: "DERIVED_FROM_PARENT_IDS" }); };
  for (const person of index.people) {
    const parents = parentsOf(index, person.id);
    for (const parent of parents) for (const grandparent of parentsOf(index, parent)) add(person.id, grandparent, "GRANDPARENT", { method: "TWO_PARENT_EDGES", via: parent });
    for (const parent of parents) for (const uncle of siblingsOf(index, parent)) add(person.id, uncle, "UNCLE_AUNT", { method: "PARENT_SIBLING", via: parent });
    const siblingParents = new Map<string, string[]>();
    for (const sibling of siblingsOf(index, person.id)) for (const parent of parentsOf(index, sibling)) { const list = siblingParents.get(parent) ?? []; list.push(sibling); siblingParents.set(parent, list); }
    for (const cousins of Array.from(siblingParents.values())) for (const cousin of cousins) add(person.id, cousin, "COUSIN", { method: "SHARED_GRANDPARENT", sharedParentOfSibling: true });
  }
  for (const rel of output.slice()) { if (rel.type === "GRANDPARENT") add(rel.personBId, rel.personAId, "GRANDCHILD", rel.evidence); if (rel.type === "UNCLE_AUNT") add(rel.personBId, rel.personAId, "NIECE_NEPHEW", rel.evidence); }
  for (const parent of index.people) void childrenOf(index, parent.id);
  return output;
}
