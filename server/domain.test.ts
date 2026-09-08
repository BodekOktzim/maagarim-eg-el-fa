import { describe, expect, it } from "vitest";
import { buildIndex, demoRecords, familyFor, normalizeAddress, normalizeNationalId, normalizePhone, searchIndex, streamRecords } from "./domain";

describe("synthetic intelligence domain", () => {
  const index = buildIndex();
  it("normalizes identifiers consistently", () => {
    expect(normalizeNationalId("100-000-003")).toBe("100000003");
    expect(normalizePhone("050-1234567")).toBe("972501234567");
    expect(normalizePhone("+972501234567")).toBe("972501234567");
    expect(normalizeAddress("רחוב הרצל 10")).toBe("הרצל 10");
  });
  it("resolves Yossi siblings only from shared deterministic parent IDs", () => {
    const yossi = index.people.find((p) => p.firstName === "יוסי")!;
    const family = familyFor(index, yossi.id, 1);
    expect(family.people.map((p) => p.firstName)).toEqual(expect.arrayContaining(["אבי", "דינה", "משה", "גבי"]));
    expect(family.relationships.filter((r) => r.type === "SIBLING").length).toBeGreaterThan(0);
  });
  it("does not merge same names or addresses without an exact identity key", () => {
    const records = [...demoRecords, { ...demoRecords[3], externalId: "other-name", nationalId: "100000099", firstName: "יוסי", address: "הרצל 10", payload: {} }];
    const custom = buildIndex(records);
    expect(custom.people.filter((p) => p.fullName === "יוסי כהן")).toHaveLength(2);
  });
  it("supports indexed search and pagination", () => {
    expect(searchIndex(index, "100000003", "national_id").items[0]?.firstName).toBe("יוסי");
    expect(searchIndex(index, "0501234567", "phone").items[0]?.firstName).toBe("יוסי");
    expect(searchIndex(index, "כהן", "name", 1, 2).items).toHaveLength(2);
  });
  it("streams records in bounded batches", async () => {
    const batches: number[] = []; for await (const batch of streamRecords(demoRecords, 2)) batches.push(batch.length);
    expect(batches).toEqual([2, 2, 2]);
  });
});
