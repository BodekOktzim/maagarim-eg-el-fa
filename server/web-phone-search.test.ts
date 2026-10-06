import { describe, expect, it } from "vitest";
import { buildQueries, filterExactPhoneResults } from "./web-phone-search";
import { buildPhoneIntelligence, enrichWebPhoneResults } from "./web-phone-intelligence";

const query = '"0501234567"';

describe("filterExactPhoneResults", () => {
  it("keeps a result only when the exact local number appears in source text", () => {
    const results = filterExactPhoneResults([
      { title: "Relevant page", url: "https://example.com/relevant", raw_content: "Contact: 050-1234567" },
      { title: "Unrelated page", url: "https://example.com/unrelated", raw_content: "Contact: 054-7654321" },
    ], "0501234567", query);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      url: "https://example.com/relevant",
      matchedPhone: "050-1234567",
      matchLocation: "page-text",
    });
    expect(results[0].snippet).toContain("050-1234567");
    expect(results[0].relevanceLabel).toBeDefined();
  });

  it("treats an Israeli international-format number as the same number", () => {
    const results = filterExactPhoneResults([
      { title: "International format", url: "https://example.com/intl", raw_content: "Phone: +972 (50) 123-4567" },
    ], "0501234567", query);

    expect(results).toHaveLength(1);
    expect(results[0].matchedPhone).toBe("+972 (50) 123-4567");
  });

  it("does not accept a longer number that merely contains the searched digits", () => {
    const results = filterExactPhoneResults([
      { title: "Long number", url: "https://example.com/long", content: "Call 9725012345679" },
      { title: "Embedded number", url: "https://example.com/embedded", content: "Ref: 9990501234567" },
    ], "0501234567", query);

    expect(results).toHaveLength(0);
  });

  it("uses full extracted page text when the provider snippet omits the number without exposing nearby text", () => {
    const results = filterExactPhoneResults([
      { title: "Page with exact phone", url: "https://example.com/full-text", content: "A general snippet", raw_content: "Directory entry — telephone 050 123 4567 — published listing." },
    ], "0501234567", query);

    expect(results).toHaveLength(1);
    expect(results[0].snippet).toContain("050 123 4567");
    expect(results[0].snippet).not.toContain("Directory entry");
  });

  it("rejects semantic-only matches even when the title is relevant", () => {
    const results = filterExactPhoneResults([
      { title: "Phone contact for 054-7654321", url: "https://example.com/wrong", content: "This page mentions a phone listing." },
    ], "0501234567", query);

    expect(results).toHaveLength(0);
  });

  it("keeps a provider-snippet match separate from full page-text evidence", () => {
    const results = filterExactPhoneResults([
      { title: "Relevant summary", url: "https://example.com/summary", content: "Contact: 050-1234567" },
    ], "0501234567", query);

    expect(results).toHaveLength(1);
    expect(results[0].matchLocation).toBe("provider-snippet");
    expect(results[0].relevanceLabel).toBe("נמוכה");
  });

  it("rejects an exact phone that appears only in a title or URL", () => {
    const results = filterExactPhoneResults([
      { title: "050-1234567 directory", url: "https://example.com/0501234567", content: "The page body does not include a phone." },
    ], "0501234567", query);

    expect(results).toHaveLength(0);
  });

  it("rejects non-http result URLs", () => {
    const results = filterExactPhoneResults([
      { title: "Invalid URL", url: "javascript:alert(1)", content: "050-1234567" },
    ], "0501234567", query);

    expect(results).toHaveLength(0);
  });

  it("builds multiple coverage queries for social, directory, and Israeli contexts", () => {
    const queries = buildQueries({
      local: "0501234567",
      international: "+972501234567",
      variants: ["0501234567", "050-1234567", "050 1234567", "+972501234567"],
    });
    expect(queries.length).toBeGreaterThanOrEqual(5);
    expect(queries.some((query) => query.includes("Instagram"))).toBe(true);
    expect(queries.some((query) => query.includes("directory"))).toBe(true);
  });

  it("ranks pages with useful surrounding context above bare phone mentions", () => {
    const results = filterExactPhoneResults([
      { title: "Phone directory", url: "https://example.com/bare", raw_content: "050-1234567" },
      { title: "Business contact Instagram", url: "https://example.com/context", raw_content: "Business contact and WhatsApp: 050-1234567. Instagram profile and service details." },
    ], "0501234567", query);
    expect(results[0].url).toBe("https://example.com/context");
    expect(results[0].relevanceScore).toBeGreaterThan(results[1].relevanceScore);
  });

  it("builds Israeli phone intelligence with local and international formats", () => {
    const intelligence = buildPhoneIntelligence("+972 50-123-4567");
    expect(intelligence).toMatchObject({ local: "0501234567", international: "+972501234567", country: "ישראל", likelyLineType: "mobile" });
    expect(intelligence.formats).toContain("972501234567");
    expect(intelligence.formats).toContain("050-1234567");
  });

  it("extracts public social evidence and groups repeated entity labels", () => {
    const base = { source: "Tavily", query, matchedPhone: "050-1234567", relevanceScore: 80, relevanceLabel: "גבוהה" as const, matchLocation: "page-text" as const };
    const { results, groups } = enrichWebPhoneResults([
      { ...base, title: "דוגמה שירותים", url: "https://www.facebook.com/example", snippet: "צור קשר: 050-1234567" },
      { ...base, title: "דוגמה שירותים", url: "https://example.co.il/contact", snippet: "עסק: דוגמה שירותים · 050-1234567" },
    ]);
    expect(results[0].socialProfiles[0]).toMatchObject({ platform: "facebook", username: "example" });
    expect(groups[0]).toMatchObject({ label: "דוגמה שירותים", confidence: "possible", sourceCount: 2 });
    expect(groups[0].evidence).toHaveLength(2);
  });
});
