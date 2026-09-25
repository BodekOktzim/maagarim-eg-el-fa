import { describe, expect, it } from "vitest";
import { buildSearchResultsCsv } from "../client/src/lib/search-export";

describe("search results export", () => {
  it("exports UTF-8 BOM, structured search rows, and evidence-backed family links", () => {
    const csv = buildSearchResultsCsv(
      [{ id: "p1", fullName: "דנה לוי", nationalId: "123456789", sourceNames: ["AGRON2006"] }],
      [
        { id: "p1", fullName: "דנה לוי", nationalId: "123456789" },
        { id: "p2", fullName: "נועה לוי", nationalId: "987654321" },
      ],
      [{ personAId: "p1", personBId: "p2", type: "SIBLING", source: "AGRON2006", evidence: { method: "SHARED_PARENT_IDS" } }],
      "p1",
    );

    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain("\"סוג שורה\",\"שם\",\"תעודת זהות\"");
    expect(csv).toContain("\"תוצאת חיפוש\",\"דנה לוי\",\"123456789\"");
    expect(csv).toContain("\"קשר משפחתי\",\"דנה לוי\"");
    expect(csv).toContain("\"אח/ות\",\"נועה לוי\"");
    expect(csv).toContain("SHARED_PARENT_IDS");
  });

  it("escapes quotes and neutralizes spreadsheet formula cells", () => {
    const csv = buildSearchResultsCsv([
      { id: "p1", fullName: '=HYPERLINK("https://example.com","click")', address: "דרך \"השלום\"" },
    ]);

    expect(csv).toContain("'=HYPERLINK(\"\"https://example.com\"\",\"\"click\"\")");
    expect(csv).toContain("\"דרך \"\"השלום\"\"\"");
  });
});
