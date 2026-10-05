import { describe, expect, it } from "vitest";
import { hashSecret, verifySecret } from "./access-auth";

describe("access authentication primitives", () => {
  it("stores a salted scrypt hash and verifies only the original secret", async () => {
    const hash = await hashSecret("correct-access-code");
    expect(hash.startsWith("scrypt$")).toBe(true);
    expect(await verifySecret("correct-access-code", hash)).toBe(true);
    expect(await verifySecret("wrong-access-code", hash)).toBe(false);
  });

  it("does not reuse the same salt for repeated hashes", async () => {
    const first = await hashSecret("same-secret");
    const second = await hashSecret("same-secret");
    expect(first).not.toBe(second);
  });
});
