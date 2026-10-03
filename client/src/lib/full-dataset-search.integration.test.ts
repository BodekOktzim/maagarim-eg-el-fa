import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./offline-data", () => ({
  readOfflineFile: vi.fn(async () => null),
  readOfflineUrlRange: vi.fn(async () => null),
}));

type Posting = { key: number; offset: number; length: number };
type SourceFixture = { key: string; file: string; bytes: Buffer; nationalId: number; facebookId?: bigint };

const textEncoder = new TextEncoder();
const hash32 = (value: string) => {
  let hash = 2166136261;
  for (const byte of textEncoder.encode(value.toLowerCase())) {
    hash ^= byte;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
};
const bigrams = (value: string) => Array.from(new Set(Array.from({ length: Math.max(0, value.length - 1) }, (_, index) => value.slice(index, index + 2))));
const postingBytes = (items: Posting[]) => {
  const output = Buffer.alloc(items.length * 16);
  items.forEach((item, index) => {
    const offset = index * 16;
    output.writeUInt32LE(item.key >>> 0, offset);
    output.writeBigUInt64LE(BigInt(item.offset), offset + 4);
    output.writeUInt32LE(item.length, offset + 12);
  });
  return output;
};
const facebookIdBytes = (id: bigint, offset: number, length: number) => {
  const output = Buffer.alloc(20);
  output.writeBigUInt64LE(id, 0);
  output.writeBigUInt64LE(BigInt(offset), 8);
  output.writeUInt32LE(length, 16);
  return output;
};
const sparse32Bytes = (key: number, ordinal = 0) => {
  const output = Buffer.alloc(12);
  output.writeUInt32LE(key >>> 0, 0);
  output.writeBigUInt64LE(BigInt(ordinal), 4);
  return output;
};
const sparseIdBytes = (key: number, ordinal = 0) => {
  const output = Buffer.alloc(16);
  output.writeUInt32LE(key >>> 0, 0);
  output.writeBigUInt64LE(BigInt(ordinal), 4);
  return output;
};
const sparse64Bytes = (key: bigint, ordinal = 0) => {
  const output = Buffer.alloc(16);
  output.writeBigUInt64LE(key, 0);
  output.writeBigUInt64LE(BigInt(ordinal), 8);
  return output;
};

function makeFixture() {
  const agronFields = Array.from({ length: 26 }, () => "");
  agronFields[0] = "12345";
  agronFields[1] = "Synthetic";
  agronFields[2] = "Fixture";
  agronFields[7] = "Mock Avenue";
  agronFields[8] = "1";
  agronFields[11] = "Testville";
  agronFields[13] = "0000000";
  agronFields[14] = "37";
  const electorFields = Array.from({ length: 10 }, () => "");
  electorFields[1] = "Synthetic";
  electorFields[2] = "Fixture";
  electorFields[3] = "12345";
  electorFields[4] = "0000000";
  electorFields[5] = "Mock Avenue";
  electorFields[6] = "1";
  electorFields[7] = "Testville";
  electorFields[9] = "999";
  const facebookFields = Array.from({ length: 12 }, () => "");
  facebookFields[0] = "0000000";
  facebookFields[1] = "9007199254740993";
  facebookFields[2] = "Synthetic";
  facebookFields[3] = "Fixture";
  facebookFields[4] = "female";
  facebookFields[7] = "Single";

  const sources: SourceFixture[] = [
    { key: "agron2006", file: "AGRON2006.txt", bytes: Buffer.from(`${agronFields.join("\t")}\n`), nationalId: 12345 },
    { key: "elector", file: "Elector.txt", bytes: Buffer.from(`${electorFields.join(",")}\n`), nationalId: 12345 },
    { key: "facebook", file: "Facebook.txt", bytes: Buffer.from(`${facebookFields.join(":")}\n`), nationalId: 0, facebookId: 9007199254740993n },
  ];
  const dataByPath = new Map(sources.map((source) => [`datasets/${source.file}`, source.bytes]));
  const idByPath = new Map<string, Buffer>();
  const extensionIndexes: Record<string, Record<string, unknown>> = {};
  const indexByPath = new Map<string, Buffer>();
  const sparseByPath = new Map<string, Buffer>();

  const addPostingIndex = (key: string, source: SourceFixture, entries: Posting[]) => {
    const file = `${key}.bin`;
    const sparseFile = `${key}.sparse.bin`;
    const bytes = postingBytes(entries);
    extensionIndexes[key] = {
      source: source.key,
      dataFile: source.file,
      records: entries.length,
      indexFile: file,
      kind: key.startsWith("age-") ? "age" : "postings",
      indexBytes: bytes.length,
      sparseFile,
      sparseBytes: 0,
      blockRecords: 4096,
    };
    indexByPath.set(`search-index-full/${file}`, bytes);
  };

  for (const source of sources) {
    const length = source.bytes.length;
    const idIndex = Buffer.alloc(16);
    idIndex.writeUInt32LE(source.nationalId, 0);
    idIndex.writeBigUInt64LE(0n, 4);
    idIndex.writeUInt32LE(length, 12);
    idByPath.set(`search-index-full/${source.key}.bin`, idIndex);
    sparseByPath.set(`index-seek/${source.key}.sparse.bin`, sparseIdBytes(source.nationalId));

    if (source.key === "agron2006") {
      const first = "Synthetic";
      const last = "Fixture";
      const city = "Testville";
      const address = "Mock Avenue 1 Testville";
      addPostingIndex("text-agron-first", source, bigrams(first).map((gram) => ({ key: hash32(gram), offset: 0, length })));
      addPostingIndex("text-agron-last", source, bigrams(last).map((gram) => ({ key: hash32(gram), offset: 0, length })));
      addPostingIndex("text-agron-city", source, bigrams(city).map((gram) => ({ key: hash32(gram), offset: 0, length })));
      addPostingIndex("text-agron-address-0", source, bigrams(address).map((gram) => ({ key: hash32(gram), offset: 0, length })));
      addPostingIndex("phone-agron", source, [{ key: hash32("0000000"), offset: 0, length }]);
      addPostingIndex("age-agron", source, [{ key: 37, offset: 0, length }]);
    } else if (source.key === "elector") {
      addPostingIndex("text-elector-first", source, bigrams("Synthetic").map((gram) => ({ key: hash32(gram), offset: 0, length })));
      addPostingIndex("text-elector-last", source, bigrams("Fixture").map((gram) => ({ key: hash32(gram), offset: 0, length })));
      addPostingIndex("text-elector-address-0", source, bigrams("Mock Avenue 1 Testville").map((gram) => ({ key: hash32(gram), offset: 0, length })));
      addPostingIndex("phone-elector", source, [{ key: hash32("0000000"), offset: 0, length }]);
    } else {
      addPostingIndex("text-facebook-first-candidate", source, bigrams("Synthetic").map((gram) => ({ key: hash32(gram), offset: 0, length })));
      addPostingIndex("text-facebook-last-candidate", source, bigrams("Fixture").map((gram) => ({ key: hash32(gram), offset: 0, length })));
      addPostingIndex("phone-facebook-candidate", source, [{ key: hash32("0000000"), offset: 0, length }]);
      const file = "facebook-id.bin";
      const bytes = facebookIdBytes(source.facebookId!, 0, length);
      extensionIndexes["facebook-id"] = {
        source: "Facebook",
        dataFile: source.file,
        records: 1,
        indexFile: file,
        kind: "facebook-id",
        indexBytes: bytes.length,
        sparseFile: "facebook-id.sparse.bin",
        sparseBytes: 0,
        blockRecords: 4096,
      };
      indexByPath.set(`search-index-full/${file}`, bytes);
      sparseByPath.set("index-seek/facebook-id.sparse.bin", sparse64Bytes(source.facebookId!));
    }
  }

  const manifest = {
    recordBytes: 16,
    blockRecords: 4096,
    sources: sources.map((source) => ({
      key: source.key,
      file: source.file,
      records: 1,
      indexBytes: 16,
      sparseBytes: 0,
      sourceBytes: source.bytes.length,
    })),
  };
  const extensions = { postRecordBytes: 16, edgeRecordBytes: 20, indexes: extensionIndexes };
  const rangeResponse = (bytes: Buffer, init?: RequestInit) => {
    const range = new Headers(init?.headers).get("Range");
    if (!range) return new Response(bytes);
    const match = range.match(/^bytes=(\d+)-(\d+)$/);
    if (!match) return new Response(null, { status: 416 });
    const start = Number(match[1]);
    const end = Number(match[2]);
    if (start >= bytes.length) return new Response(null, { status: 416 });
    return new Response(bytes.subarray(start, Math.min(end + 1, bytes.length)), { status: 206 });
  };

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "https://app.example.test");
    if (url.pathname.endsWith("/index-seek/manifest.json")) return new Response(JSON.stringify(manifest), { headers: { "content-type": "application/json" } });
    if (url.pathname.endsWith("/index-seek/extensions-manifest.json")) return new Response(JSON.stringify(extensions), { headers: { "content-type": "application/json" } });
    if (url.pathname.includes("/index-seek/") && url.pathname.endsWith(".sparse.bin")) {
      const relative = `index-seek/${decodeURIComponent(url.pathname.split("/index-seek/")[1])}`;
      return new Response(sparseByPath.get(relative) ?? new Uint8Array());
    }
    const indexMarker = "/search-index-full/";
    const dataMarker = "/datasets/";
    const indexAt = url.pathname.indexOf(indexMarker);
    if (indexAt >= 0) {
      const relative = `search-index-full/${decodeURIComponent(url.pathname.slice(indexAt + indexMarker.length))}`;
      const bytes = indexByPath.get(relative) ?? idByPath.get(relative);
      return bytes ? rangeResponse(bytes, init) : new Response(null, { status: 404 });
    }
    const dataAt = url.pathname.indexOf(dataMarker);
    if (dataAt >= 0) {
      const relative = `datasets/${decodeURIComponent(url.pathname.slice(dataAt + dataMarker.length))}`;
      const bytes = dataByPath.get(relative);
      return bytes ? rangeResponse(bytes, init) : new Response(null, { status: 404 });
    }
    return new Response(null, { status: 404 });
  });
  return { fetchMock };
}

describe("synthetic end-to-end search paths and timings", () => {
  beforeEach(() => {
    vi.resetModules();
    const fixture = makeFixture();
    vi.stubGlobal("fetch", fixture.fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("returns expected synthetic matches for each UI search type", async () => {
    const search = await import("./full-dataset-search");
    const timings: Record<string, number> = {};
    const measure = async <T,>(name: string, operation: () => Promise<T>) => {
      const started = performance.now();
      const value = await operation();
      timings[name] = Number((performance.now() - started).toFixed(2));
      return value;
    };

    const id = await measure("national-id/all", () => search.searchFullDatasetsByIdWithDetails("12345", "all"));
    expect(id).toHaveLength(1);
    expect(id[0].sourceNames).toEqual(expect.arrayContaining(["AGRON 2006", "Elector"]));

    const exactName = await measure("name/exact/all", () => search.searchFullDatasetsByText({ firstName: "Synthetic", lastName: "Fixture" }, "exact", "all"));
    expect(exactName).toHaveLength(2);
    expect(exactName.map((hit) => hit.sourceKey).sort()).toEqual(["agron2006", "facebook"].sort());

    const similarName = await measure("name/similar/facebook", () => search.searchFullDatasetsByText({ firstName: "Synthetic", lastName: "Fixturx" }, "similar", "facebook"));
    expect(similarName).toHaveLength(1);
    expect(similarName[0].confidence).toBe("approximate-text-match");

    const location = await measure("location/all", () => search.searchFullDatasetsByText({ firstName: "Synthetic", location: "Testville" }, "exact", "all"));
    expect(location).toHaveLength(1);
    expect(location[0].sourceNames).toEqual(expect.arrayContaining(["AGRON 2006", "Elector"]));

    const age = await measure("name+age/agron", () => search.searchFullDatasetsByText({ firstName: "Synthetic", age: "37" }, "exact", "agron2006"));
    expect(age).toHaveLength(1);
    expect(age[0].fullName).toBe("Synthetic Fixture");

    const phone = await measure("phone/all", () => search.searchFullDatasetsByPhone("0000000", "all"));
    expect(phone).toHaveLength(2);
    expect(phone.some((hit) => hit.sourceKey === "facebook")).toBe(true);
    const facebookPhone = await measure("phone/facebook", () => search.searchFullDatasetsByPhone("0000000", "facebook"));
    expect(facebookPhone).toHaveLength(1);
    expect(facebookPhone[0].sourceKey).toBe("facebook");

    const facebookName = await measure("facebook/name", () => search.searchFullDatasetsByText({ firstName: "Synthetic", lastName: "Fixture" }, "exact", "facebook"));
    expect(facebookName).toHaveLength(1);
    expect(facebookName[0].facebookId).toBe("9007199254740993");

    const facebookId = await measure("facebook/id", () => search.searchFullDatasetsByFacebookId("9007199254740993", "facebook"));
    expect(facebookId).toHaveLength(1);
    expect(facebookId[0].confidence).toBe("facebook-id-match");

    const family = await measure("family-tree/id", () => search.searchFamilyTreeById("12345"));
    expect(family.people.some((person) => person.id === "000012345")).toBe(true);

    await expect(search.searchFullDatasetsByText({ age: "37" }, "exact", "all")).rejects.toThrow("יש להזין שם פרטי או שם משפחה");
    await expect(search.searchFullDatasetsByText({ location: "Testville" }, "exact", "all")).rejects.toThrow("יש להזין שם פרטי או שם משפחה");
    await expect(search.searchFullDatasetsByText({ firstName: "Synthetic" }, "exact", "facebook")).rejects.toThrow("יש למלא גם שם פרטי וגם שם משפחה");

    console.info("Synthetic search timings (ms):", JSON.stringify(timings));
  });
});
