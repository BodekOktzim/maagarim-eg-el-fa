import { describe, expect, it } from "vitest";
import { normalizeWebPhonePayload } from "./web-phone-contract";

describe("normalizeWebPhonePayload", () => {
  it("fills missing array fields before the intelligence panel renders", () => {
    const payload = normalizeWebPhonePayload({
      phone: { local: "0501234567", international: "+972501234567", likelyLineType: "mobile" },
      results: [{ title: "Facebook result", url: "https://facebook.com/example", snippet: "0501234567" }],
      groups: [{
        label: "Example",
        confidence: "possible",
        confidenceScore: 55,
        sourceCount: 1,
        // platforms, socialProfiles, reasons, evidenceIds, evidence and contradictions are intentionally absent.
      }],
    });

    expect(payload.phone?.formats).toEqual([]);
    expect(payload.results[0].platforms).toEqual([]);
    expect(payload.results[0].socialProfiles).toEqual([]);
    expect(payload.results[0].evidence).toEqual([]);
    expect(payload.results[0].entityLabels).toEqual([]);
    expect(payload.results[0].relatedPhones).toEqual([]);
    expect(payload.results[0].contextKeywords).toEqual([]);
    expect(payload.groups[0].platforms).toEqual([]);
    expect(payload.groups[0].supportingSources).toEqual([]);
    expect(payload.groups[0].reasons).toEqual([]);
    expect(payload.groups[0].evidenceIds).toEqual([]);
    expect(payload.groups[0].evidence).toEqual([]);
    expect(payload.groups[0].contradictions).toEqual([]);

    // These are the exact operations performed by the panel; none may throw.
    expect(payload.groups[0].supportingSources.join(" · ")).toBe("");
    expect(payload.groups[0].contradictions.join(" · ")).toBe("");
    expect(payload.groups[0].reasons.map((reason) => reason).join(" ")).toBe("");
  });

  it("filters non-string array members instead of passing malformed data to React", () => {
    const payload = normalizeWebPhonePayload({
      results: [{ platforms: ["facebook", null, 7], relatedPhones: ["0527654321", undefined] }],
      groups: [{ reasons: ["ok", null], evidenceIds: ["evidence-1", 4], contradictions: ["conflict", {}] }],
    });

    expect(payload.results[0].platforms).toEqual(["facebook"]);
    expect(payload.results[0].relatedPhones).toEqual(["0527654321"]);
    expect(payload.groups[0].reasons).toEqual(["ok"]);
    expect(payload.groups[0].evidenceIds).toEqual(["evidence-1"]);
    expect(payload.groups[0].contradictions).toEqual(["conflict"]);
  });
});
