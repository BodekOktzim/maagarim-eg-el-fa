import { describe, expect, it } from "vitest";
import type { SearchHit } from "@/lib/full-dataset-search";
import { buildSearchResultRows, buildSearchResultsCsv, createSearchExportBlob, SEARCH_EXPORT_FORMATS } from "@/lib/search-export";

const sampleHit: SearchHit = {
  source: "AGRON 2006",
  sourceKey: "agron2006",
  confidence: "approximate-text-match",
  nationalId: "123456789",
  fullName: 'דוד <img src=x onerror="alert(1)">',
  firstName: "דוד",
  lastName: "כהן",
  phone: "0501234567",
  address: "רחוב הרצל 1",
  city: "חיפה",
  birthDate: "1973-10-26",
  sourceNames: ["AGRON 2006", "Elector"],
};

describe("search result exports", () => {
  it("offers eight formats and maps all visible personal/source fields", () => {
    expect(SEARCH_EXPORT_FORMATS).toHaveLength(8);
    const [row] = buildSearchResultRows([sampleHit]);
    expect(row).toMatchObject({
      "שם מלא": sampleHit.fullName,
      "תעודת זהות": "123456789",
      "טלפון": "0501234567",
      "יישוב": "חיפה",
      "מקורות": "AGRON 2006; Elector",
      "סוג התאמה": "התאמה דומה",
    });
  });

  it("builds each text-based export without losing Hebrew text", async () => {
    const rows = buildSearchResultRows([sampleHit]);
    const expectedExtensions = ["csv", "tsv", "json", "jsonl", "txt", "html", "xml"] as const;
    for (const format of expectedExtensions) {
      const blob = await createSearchExportBlob(rows, format);
      expect(blob.size).toBeGreaterThan(0);
      expect(await blob.text()).toContain("חיפה");
    }
  });

  it("escapes HTML/XML data and protects delimited files from spreadsheet formulas", async () => {
    const dangerous: SearchHit = { ...sampleHit, fullName: "<script>alert(1)</script>", phone: "=cmd|calc" };
    const rows = buildSearchResultRows([dangerous]);
    const html = await createSearchExportBlob(rows, "html").then((blob) => blob.text());
    const xml = await createSearchExportBlob(rows, "xml").then((blob) => blob.text());
    const csv = await createSearchExportBlob(rows, "csv").then((blob) => blob.text());
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
    expect(xml).toContain("&lt;script&gt;");
    expect(csv).toContain("'=cmd|calc");
  });

  it("creates a readable XLSX workbook", async () => {
    const blob = await createSearchExportBlob(buildSearchResultRows([sampleHit]), "xlsx");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(blob.type).toContain("spreadsheetml.sheet");
    expect(Array.from(bytes.slice(0, 2))).toEqual([0x50, 0x4b]);
  });

  it("includes family people and relationships in the person export", () => {
    const csv = buildSearchResultsCsv(
      [{ id: sampleHit.nationalId, fullName: sampleHit.fullName, nationalId: sampleHit.nationalId }],
      [{ id: "987654321", fullName: "הורה ישראלי", nationalId: "987654321" }],
      [{ personAId: sampleHit.nationalId, personBId: "987654321", type: "PARENT", source: "AGRON" }],
      sampleHit.nationalId,
    );
    expect(csv).toContain("הורה ישראלי");
    expect(csv).toContain("קשר משפחתי");
    expect(csv).toContain("הורה של האדם המרכזי");
  });
});
