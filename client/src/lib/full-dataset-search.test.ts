import { describe, expect, it } from "vitest";
import { applyFacebookDetails, currentAgeFromBirthDate, formatBirthDate, mergeHits, mergePhoneHits, mergeTextSearchHits, parseAgeRange, parseFacebookHit, textMatchesWithinSource, toFamilyTreePerson, type SearchHit } from "./full-dataset-search";

const hit = (overrides: Partial<SearchHit>): SearchHit => ({
  source: "test",
  sourceKey: "agron2006",
  confidence: "exact-id",
  nationalId: "012345678",
  fullName: "ישראל ישראלי",
  ...overrides,
});

describe("unified AGRON/Elector result merging", () => {
  it("accepts a single age or an inclusive age range", () => {
    expect(parseAgeRange("20")).toEqual({ min: 20, max: 20 });
    expect(parseAgeRange("20-30")).toEqual({ min: 20, max: 30 });
    expect(parseAgeRange("20 – 30")).toEqual({ min: 20, max: 30 });
    expect(() => parseAgeRange("30-20")).toThrow();
    expect(() => parseAgeRange("abc")).toThrow();
  });

  it("calculates age against today's date rather than a stale source age", () => {
    const today = new Date();
    const beforeBirthday = new Date(today.getFullYear() - 30, today.getMonth(), today.getDate() + 1);
    const afterBirthday = new Date(today.getFullYear() - 30, today.getMonth(), Math.max(1, today.getDate() - 1));
    const format = (value: Date) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
    expect(currentAgeFromBirthDate(format(beforeBirthday))).toBe("29");
    expect(currentAgeFromBirthDate(format(afterBirthday))).toBe("30");
    expect(formatBirthDate("1981-02-26")).toBe("26/02/1981");
    expect(formatBirthDate("26/02/1981")).toBe("26/02/1981");
    expect(currentAgeFromBirthDate("26/02/1981")).toBe(currentAgeFromBirthDate("1981-02-26"));
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
      previousAddress: "כתובת ישנה",
      previousAddressYear: "2006",
      phone: "0502222222",
      phoneYear: "2020",
      fatherId: "000000001",
    });
  });

  it("maps Facebook marital status without treating its profile ID as a national ID", () => {
    const fields = Array.from({ length: 12 }, () => "");
    fields[0] = "0501234567";
    fields[1] = "1402470716";
    fields[2] = "David";
    fields[3] = "Cohen";
    fields[4] = "male";
    fields[7] = "Married";
    expect(parseFacebookHit(fields.join(":"))).toMatchObject({
      nationalId: "",
      facebookId: "1402470716",
      phone: "0501234567",
      maritalStatus: "נשוי",
    });
  });

  it("attaches Facebook marital status only when normalized phone and both names match", () => {
    const elector = hit({ source: "Elector", sourceKey: "elector", firstName: "דוד", lastName: "כהן", phone: "08-7654321", phoneCandidates: ["08-7654321", "08-1234567"] });
    const facebook = hit({ source: "Facebook", sourceKey: "facebook", firstName: "דוד", lastName: "כהן", phone: "08-1234567", maritalStatus: "נשוי" });
    const unrelated = { ...facebook, firstName: "משה" };

    expect(applyFacebookDetails([elector], [facebook])[0].maritalStatus).toBe("נשוי");
    expect(applyFacebookDetails([elector], [unrelated])[0].maritalStatus).toBeUndefined();
  });

  it("shows the same merged details when a person is selected in the family tree", () => {
    const person = toFamilyTreePerson("012345678", [
      hit({ source: "AGRON 2006", firstName: "דוד", lastName: "כהן", fullName: "דוד כהן", phone: "08-1234567", address: "רחוב ישן 10", addressYear: "2006", birthDate: "26/02/1981", maritalStatus: "נשוי" }),
      hit({ source: "Elector", sourceKey: "elector", firstName: "דוד", lastName: "כהן", fullName: "דוד כהן", phone: "08-7654321", address: "רחוב חדש 13", addressYear: "2020" }),
    ]);
    expect(person).toMatchObject({
      nationalId: "012345678",
      phone: "08-7654321",
      phoneYear: "2020",
      address: "רחוב חדש 13",
      addressYear: "2020",
      previousAddress: "רחוב ישן 10",
      previousAddressYear: "2006",
      birthDate: "26/02/1981",
      maritalStatus: "נשוי",
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

  it("finds a one-letter surname typo only in similar mode and keeps age exact", () => {
    const person = hit({ firstName: "דוד", lastName: "כהן", fullName: "דוד כהן", age: "52" });
    expect(textMatchesWithinSource(person, { lastName: "כהו" })).toBe(false);
    expect(textMatchesWithinSource(person, { lastName: "כהו" }, "similar")).toBe(true);
    expect(mergeTextSearchHits([person], { lastName: "כהו" }, "similar")[0]?.confidence).toBe("approximate-text-match");
    expect(textMatchesWithinSource(person, { lastName: "כהו", age: "51" }, "similar")).toBe(false);
    expect(textMatchesWithinSource(person, { lastName: "כהן", age: "52" }, "similar")).toBe(true);
    const cityRecord = hit({ city: "מטולה" });
    expect(textMatchesWithinSource(cityRecord, { city: "מטולא" })).toBe(false);
    expect(textMatchesWithinSource(cityRecord, { city: "מטולא" }, "similar")).toBe(true);
  });

  it("matches inclusive age ranges", () => {
    expect(textMatchesWithinSource(hit({ age: "20" }), { age: "20-30" })).toBe(true);
    expect(textMatchesWithinSource(hit({ age: "30" }), { age: "20-30" })).toBe(true);
    expect(textMatchesWithinSource(hit({ age: "31" }), { age: "20-30" })).toBe(false);
  });

  it("matches free-text address and keeps it as an additional exact criterion", () => {
    const person = hit({ firstName: "ישראל", lastName: "ביטון", city: "רמת גן", address: "דולצין 20 שכונת הבורסה רמת גן" });
    expect(textMatchesWithinSource(person, { address: "דולצין 20" })).toBe(true);
    expect(textMatchesWithinSource(person, { lastName: "ביטון", address: "רמת גן" })).toBe(true);
    expect(textMatchesWithinSource(person, { address: "חיפה" })).toBe(false);
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
