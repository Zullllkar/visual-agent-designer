import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { isLocalAppUrl, isHttpUrl, isAgentDeeplink } = require("./origin.cjs") as {
  isLocalAppUrl: (href: string, port: number) => boolean;
  isHttpUrl: (href: string) => boolean;
  isAgentDeeplink: (href: string) => boolean;
};

describe("isLocalAppUrl", () => {
  it("allows the desktop sidecar origin", () => {
    expect(isLocalAppUrl("http://127.0.0.1:3000/projects/p1", 3000)).toBe(true);
    expect(isLocalAppUrl("http://localhost:3000/", 3000)).toBe(true);
  });

  it("rejects a different port or host", () => {
    expect(isLocalAppUrl("http://127.0.0.1:3001/", 3000)).toBe(false);
    expect(isLocalAppUrl("https://example.com/", 3000)).toBe(false);
  });

  it("rejects junk", () => {
    expect(isLocalAppUrl("not-a-url", 3000)).toBe(false);
  });
});

describe("isHttpUrl", () => {
  it("detects http(s)", () => {
    expect(isHttpUrl("https://example.com/a")).toBe(true);
    expect(isHttpUrl("mailto:a@b.com")).toBe(false);
  });
});

describe("isAgentDeeplink", () => {
  it("allows Cursor MCP install and prompt deeplinks", () => {
    expect(isAgentDeeplink("cursor://anysphere.cursor-deeplink/mcp/install?name=vibeboard&config=e30=")).toBe(true);
    expect(isAgentDeeplink("cursor://anysphere.cursor-deeplink/prompt?text=hi")).toBe(true);
  });

  it("rejects other schemes and other cursor paths", () => {
    expect(isAgentDeeplink("cursor://anysphere.cursor-deeplink/settings")).toBe(false);
    expect(isAgentDeeplink("vscode://file/etc/passwd")).toBe(false);
    expect(isAgentDeeplink("https://cursor.com/link/prompt?text=hi")).toBe(false);
  });
});
