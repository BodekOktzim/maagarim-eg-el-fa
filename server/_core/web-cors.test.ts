import { describe, expect, it, vi } from "vitest";
import { allowedWebOrigin, setRangeResponseHeaders, setWebCors } from "./web-cors";

function fakeResponse() {
  const headers = new Map<string, string>();
  return { headers, setHeader(name: string, value: string) { headers.set(name.toLowerCase(), value); } } as never;
}

describe("protected range CORS contract", () => {
  it("allows the GitHub Pages origin even when the configured value includes a path", () => {
    vi.stubEnv("WEB_APP_ALLOWED_ORIGIN", "https://bodekoktzim.github.io/maagarim-eg-el-fa/");
    expect(allowedWebOrigin("https://bodekoktzim.github.io")).toBe("https://bodekoktzim.github.io");
    expect(allowedWebOrigin("https://evil.example")).toBe("");
    vi.unstubAllEnvs();
  });

  it("emits credentialed CORS and exposes range headers for browser reads", () => {
    const response = fakeResponse();
    const enabled = setWebCors({ headers: { origin: "https://bodekoktzim.github.io" } } as never, response);
    expect(enabled).toBe(true);
    expect(response.headers.get("access-control-allow-origin")).toBe("https://bodekoktzim.github.io");
    expect(response.headers.get("access-control-allow-credentials")).toBe("true");
    expect(response.headers.get("access-control-allow-methods")).toContain("GET");
    expect(response.headers.get("access-control-expose-headers")).toContain("Content-Range");
  });

  it("preserves upstream Content-Range and exact byte length on 206 responses", () => {
    const response = fakeResponse();
    setRangeResponseHeaders(response, new Headers({ "content-range": "bytes 10-19/100" }), 10);
    expect(response.headers.get("content-range")).toBe("bytes 10-19/100");
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(response.headers.get("content-length")).toBe("10");
  });
});
