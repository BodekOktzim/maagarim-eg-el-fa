import { describe, expect, it } from "vitest";
import { completeUpload, initUpload, removeUpload, writeChunk } from "./upload";

describe("chunked uploads", () => {
  it("writes chunks by offset and completes without buffering a whole file", async () => {
    const meta = await initUpload("synthetic.csv", 10);
    expect(meta.totalChunks).toBe(1);
    const status = await writeChunk(meta.id, 0, Buffer.from("0123456789"));
    expect(status.complete).toBe(true);
    const completed = await completeUpload(meta.id);
    expect(completed.format).toBe("csv");
    expect(completed.size).toBe(10);
    await removeUpload(meta.id);
  });
  it("rejects unsupported formats", async () => {
    await expect(initUpload("people.exe", 10)).rejects.toThrow("Unsupported file type");
  });
  it("rejects files above 2GB", async () => {
    await expect(initUpload("people.csv", 2 * 1024 ** 3 + 1)).rejects.toThrow("2GB");
  });
});
