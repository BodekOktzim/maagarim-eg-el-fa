import { describe, expect, it } from "vitest";
import { buildIndex, familyFor, searchIndex, type SyntheticRecord } from "./domain";

const records: SyntheticRecord[] = [
  { source: "AGRON2006", externalId: "gp-1", nationalId: "900000001", firstName: "דוד", lastName: "כהן", payload: {} },
  { source: "AGRON2006", externalId: "gp-2", nationalId: "900000002", firstName: "רחל", lastName: "כהן", payload: {} },
  { source: "AGRON2006", externalId: "p-1", nationalId: "900000010", firstName: "אבי", lastName: "כהן", fatherNationalId: "900000001", motherNationalId: "900000002", payload: {} },
  { source: "AGRON2006", externalId: "p-2", nationalId: "900000011", firstName: "דינה", lastName: "לוי", fatherNationalId: "900000001", motherNationalId: "900000002", payload: {} },
  { source: "AGRON2006", externalId: "central", nationalId: "900000100", facebookId: "fb-central", firstName: "יוסי", lastName: "כהן", phone: "050-1234567", birthDate: "1985-02-10", fatherNationalId: "900000010", motherNationalId: "900000020", payload: { city: "תל אביב" } },
  { source: "AGRON2006", externalId: "mother", nationalId: "900000020", firstName: "נועה", lastName: "מזרחי", payload: {} },
  { source: "AGRON2006", externalId: "cousin", nationalId: "900000200", firstName: "גבי", lastName: "לוי", fatherNationalId: "900000011", payload: {} },
];

describe("family tree evidence model", () => {
  it("keeps parent, sibling, and cousin relationships tied to exact IDs", () => {
    const index = buildIndex(records);
    const central = index.people.find((person) => person.nationalId === "900000100")!;
    const family = familyFor(index, central.id, 3);
    const names = family.people.map((person) => person.firstName);

    expect(names).toEqual(expect.arrayContaining(["יוסי", "אבי", "דינה", "דוד", "רחל", "גבי"]));
    expect(family.relationships.some((relationship) => relationship.type === "SIBLING" && relationship.evidence.method === "SHARED_PARENT_IDS")).toBe(true);
    expect(family.relationships.some((relationship) => relationship.type === "PARENT" && relationship.evidence.method === "EXACT_PARENT_ID")).toBe(true);
  });

  it("supports phone search after deterministic normalization", () => {
    const index = buildIndex(records);
    const result = searchIndex(index, "+972501234567", "phone");
    expect(result.items.map((person) => person.nationalId)).toEqual(["900000100"]);
  });

  it("supports Facebook ID and multi-field name search without requiring every field", () => {
    const index = buildIndex(records);
    expect(searchIndex(index, "fb-central", "facebook_id").items[0]?.firstName).toBe("יוסי");
    expect(searchIndex(index, "", "name", 1, 20, { firstName: "יוסי", city: "תל אביב" }).items[0]?.nationalId).toBe("900000100");
    expect(searchIndex(index, "", "name", 1, 20, { lastName: "כהן", age: new Date().getFullYear() - 1985 }).items.map((person) => person.nationalId)).toContain("900000100");
  });
});
