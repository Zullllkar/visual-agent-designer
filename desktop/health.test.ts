import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { isHealthPath, healthPayload, parseHealthResponse } = require("./health.cjs") as {
  isHealthPath: (url: string) => boolean;
  healthPayload: (ready: boolean) => { ok: true; ready: boolean };
  parseHealthResponse: (statusCode: number, body: string) => "ready" | "starting" | "down";
};

describe("isHealthPath", () => {
  it("matches /api/health with optional query", () => {
    expect(isHealthPath("/api/health")).toBe(true);
    expect(isHealthPath("/api/health?ts=1")).toBe(true);
    expect(isHealthPath("/api/providers/health")).toBe(false);
    expect(isHealthPath("/")).toBe(false);
  });
});

describe("parseHealthResponse", () => {
  it("treats ready:true as ready", () => {
    expect(parseHealthResponse(200, JSON.stringify(healthPayload(true)))).toBe(
      "ready"
    );
  });

  it("treats listening-but-compiling as starting", () => {
    expect(parseHealthResponse(200, JSON.stringify(healthPayload(false)))).toBe(
      "starting"
    );
  });

  it("treats the compiled Next health JSON as ready", () => {
    expect(parseHealthResponse(200, '{"ok":true,"name":"vibeboard"}')).toBe(
      "ready"
    );
  });

  it("treats connection-style failures as down", () => {
    expect(parseHealthResponse(0, "")).toBe("down");
    expect(parseHealthResponse(503, "starting")).toBe("down");
  });
});
