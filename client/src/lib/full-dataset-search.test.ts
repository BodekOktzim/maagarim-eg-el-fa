import { describe, expect, it } from "vitest";
import { currentAgeFromBirthDate, mergeHits, mergePhoneHits, type SearchHit } from "./full-dataset-search";

const hit = (overrides: Partial<SearchHit>): SearchHit => ({
  source: "test",
  sourceKey: "agron2006",
  confidence: "exact-id",
  nationalId: "012345678",
  fullName: "ישראל ישראלי",
  ...overrides,
});

describe("unified AGRON/Elector result merging", () => {
  it("calculates age against today's date rather than a stale source age", () => {
    const today = new Date();
    const beforeBirthday = new Date(today.getFullYear() - 30, today.getMonth(), today.getDate() + 1);
    const afterBirthday = new Date(today.getFullYear() - 30, today.getMonth(), Math.max(1, today.getDate() - 1));
    const format = (value: Date) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
    expect(currentAgeFromBirthDate(format(beforeBirthday))).toBe("29");
    expect(currentAgeFromBirthDate(format(afterBirthday))).toBe("30");
  });

  it("returns one record and prefers Elector address and phone", () => {
    const [merged] = mergeHits([
      hit({ source: "AGRON 2006", address: "כתובת ישנה", phone: "0501111111", fatherId: "000000001" }),
      hit({ source: "Elector", sourceKey: "elector", address: "כתובת עדכנית", phone: "0502222222" }),
    ]);
    expect(merged).toMatchObject({
      source: "מאגר מאוחד",
      fullName: "ישראל ישראלי",
      address: "כתובת עדכנית",
      addressYear: "2020",
      phone: "0502222222",
      phoneYear: "2020",
      fatherId: "000000001",
    });
  });

  it("keeps AGRON family identifiers when Elector has no relationship fields", () => {
    const [merged] = mergeHits([
      hit({ source: "AGRON 2006", fatherId: "000000001", motherId: "000000002" }),
      hit({ source: "Elector", sourceKey: "elector" }),
    ]);
    expect(merged.fatherId).toBe("000000001");
    expect(merged.motherId).toBe("000000002");
  });

  it("merges AGRON and Elector but keeps Facebook as a separate phone result", () => {
    const results = mergePhoneHits([
      hit({ source: "AGRON 2006", phone: "0501111111" }),
      hit({ source: "Elector", sourceKey: "elector", phone: "0502222222" }),
      hit({ source: "Facebook", sourceKey: "facebook", facebookId: "123", phone: "0503333333" }),
    ]);
    expect(results).toHaveLength(2);
    expect(results.some((result) => result.sourceKey === "facebook")).toBe(true);
    expect(results.filter((result) => result.sourceKey !== "facebook")).toHaveLength(1);
  });
});
