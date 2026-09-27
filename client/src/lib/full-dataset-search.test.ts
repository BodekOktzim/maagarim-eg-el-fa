import { describe, expect, it } from "vitest";
import { currentAgeFromBirthDate, mergeHits, mergePhoneHits, mergeTextSearchHits, textMatchesWithinSource, type SearchHit } from "./full-dataset-search";

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

  it("keeps Elector name matches until the AGRON city is checked on the unified record", () => {
    const agron = hit({
      source: "AGRON 2006", sourceKey: "agron2006", firstName: "מיכל", lastName: "כהן",
      fullName: "מיכל כהן", city: "מטולה", address: "רחוב ישן 14",
    });
    const elector = hit({
      source: "Elector", sourceKey: "elector", firstName: "מיכל", lastName: "כהן",
      fullName: "מיכל כהן", city: undefined, address: "הסביון 2, מטולה",
    });
    const facebook = hit({
      source: "Facebook", sourceKey: "facebook", firstName: "מיכל", lastName: "כהן",
      fullName: "מיכל כהן", nationalId: "1402470716", city: undefined,
    });

    expect(textMatchesWithinSource(elector, { lastName: "כהן", city: "מטולה" })).toBe(true);
    expect(textMatchesWithinSource(facebook, { lastName: "כהן", city: "מטולה" })).toBe(false);
    const [merged] = mergeTextSearchHits([agron, elector], { lastName: "כהן", city: "מטולה" });
    expect(merged).toMatchObject({
      source: "מאגר מאוחד",
      address: "הסביון 2, מטולה",
      addressYear: "2020",
      city: "מטולה",
    });
    expect(mergeTextSearchHits([agron, elector], { lastName: "כהן", city: "חיפה" })).toHaveLength(0);
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
