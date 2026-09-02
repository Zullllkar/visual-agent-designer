import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { isLocalAppUrl, isHttpUrl } = require("./origin.cjs") as {
  isLocalAppUrl: (href: string, port: number) => boolean;
  isHttpUrl: (href: string) => boolean;
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
