import type { IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";
import {
  isBridgePath,
  isLoopbackHostHeader,
  isLoopbackOrigin,
  isSameOriginOrNonBrowser,
} from "./http";

function req(headers: Record<string, string>): IncomingMessage {
  return { headers } as unknown as IncomingMessage;
}

describe("bridge http guards", () => {
  it("recognises bridge paths", () => {
    expect(isBridgePath("/mcp")).toBe(true);
    expect(isBridgePath("/mcp/status")).toBe(true);
    expect(isBridgePath("/mcp/build")).toBe(true);
    expect(isBridgePath("/mcp/build/preview")).toBe(true);
    expect(isBridgePath("/mcpx")).toBe(false);
    expect(isBridgePath("/api/mcp")).toBe(false);
  });

  it("accepts loopback Host headers only", () => {
    expect(isLoopbackHostHeader("127.0.0.1:3000")).toBe(true);
    expect(isLoopbackHostHeader("localhost:18765")).toBe(true);
    expect(isLoopbackHostHeader("[::1]:3000")).toBe(true);
    expect(isLoopbackHostHeader("192.168.1.10:3000")).toBe(false);
    expect(isLoopbackHostHeader("evil.example")).toBe(false);
    expect(isLoopbackHostHeader(undefined)).toBe(false);
  });

  it("accepts loopback origins only", () => {
    expect(isLoopbackOrigin("http://localhost:6274")).toBe(true);
    expect(isLoopbackOrigin("http://127.0.0.1:3000")).toBe(true);
    expect(isLoopbackOrigin("https://attacker.com")).toBe(false);
    expect(isLoopbackOrigin("null")).toBe(false);
  });

  it("management endpoints require same-origin for browsers, allow non-browsers", () => {
    expect(isSameOriginOrNonBrowser(req({ host: "127.0.0.1:3000" }))).toBe(true);
    expect(
      isSameOriginOrNonBrowser(req({ host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" })),
    ).toBe(true);
    expect(
      isSameOriginOrNonBrowser(req({ host: "127.0.0.1:3000", origin: "http://localhost:5173" })),
    ).toBe(false);
    expect(
      isSameOriginOrNonBrowser(req({ host: "127.0.0.1:3000", origin: "http://127.0.0.1:3001" })),
    ).toBe(false);
  });
});
