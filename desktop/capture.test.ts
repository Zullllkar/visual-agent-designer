import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { parseCaptureRequest, registrationPayload, newCaptureToken, DEFAULT_WIDTH, MAX_HEIGHT } =
  require("./capture.cjs") as {
    parseCaptureRequest: (
      body: unknown
    ) =>
      | { ok: true; request: { url: string; width: number; height: number; fullPage: boolean; delayMs: number; timeoutMs: number } }
      | { ok: false; error: string };
    registrationPayload: (input: { agentUrl: string; agentToken: string; version?: string }) => {
      url: string;
      token: string;
      pid: number;
      version: string | null;
    };
    newCaptureToken: () => string;
    DEFAULT_WIDTH: number;
    MAX_HEIGHT: number;
  };

describe("parseCaptureRequest", () => {
  it("accepts an http url and fills defaults", () => {
    const out = parseCaptureRequest({ url: "http://localhost:5173/dashboard" });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.request.url).toBe("http://localhost:5173/dashboard");
    expect(out.request.width).toBe(DEFAULT_WIDTH);
    expect(out.request.fullPage).toBe(true);
    expect(out.request.delayMs).toBe(800);
    expect(out.request.timeoutMs).toBe(25_000);
  });

  it("clamps sizes and timeouts into safe ranges", () => {
    const out = parseCaptureRequest({
      url: "https://example.com",
      width: 99_999,
      height: 12,
      delayMs: -5,
      timeoutMs: 999_999,
      fullPage: false,
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.request.width).toBe(2560);
    expect(out.request.height).toBe(320);
    expect(out.request.delayMs).toBe(0);
    expect(out.request.timeoutMs).toBe(60_000);
    expect(out.request.fullPage).toBe(false);
    expect(MAX_HEIGHT).toBeGreaterThanOrEqual(out.request.height);
  });

  it("rejects non-http schemes and garbage", () => {
    expect(parseCaptureRequest({ url: "file:///etc/passwd" }).ok).toBe(false);
    expect(parseCaptureRequest({ url: "javascript:alert(1)" }).ok).toBe(false);
    expect(parseCaptureRequest({ url: "not a url" }).ok).toBe(false);
    expect(parseCaptureRequest(null).ok).toBe(false);
    expect(parseCaptureRequest("http://x").ok).toBe(false);
  });
});

describe("registrationPayload / newCaptureToken", () => {
  it("carries url, token, pid and version", () => {
    const payload = registrationPayload({
      agentUrl: "http://127.0.0.1:4321",
      agentToken: "cap_abc",
      version: "0.1.0",
    });
    expect(payload).toEqual({
      url: "http://127.0.0.1:4321",
      token: "cap_abc",
      pid: process.pid,
      version: "0.1.0",
    });
  });

  it("generates distinct, long enough tokens", () => {
    const a = newCaptureToken();
    const b = newCaptureToken();
    expect(a).not.toBe(b);
    expect(a.startsWith("cap_")).toBe(true);
    expect(a.length).toBeGreaterThan(20);
  });
});
