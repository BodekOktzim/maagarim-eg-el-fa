import { describe, expect, it } from "vitest";
import { mergeHits, type SearchHit } from "./full-dataset-search";

const hit = (overrides: Partial<SearchHit>): SearchHit => ({
  source: "test",
  sourceKey: "agron2006",
  confidence: "exact-id",
  nationalId: "012345678",
  fullName: "ישראל ישראלי",
  ...overrides,
});

describe("unified AGRON/Elector result merging", () => {
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
});
