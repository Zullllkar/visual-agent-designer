import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  classifyAppPageResponse,
  nextConsecutiveReady,
  isAppPageStable,
} = require("./app-page.cjs") as {
  classifyAppPageResponse: (statusCode: number, body: string) => string;
  nextConsecutiveReady: (current: number, status: string) => number;
  isAppPageStable: (consecutiveReady: number, needed?: number) => boolean;
};

describe("app page wait", () => {
  it("does not leave splash after a single 200 that can still 500 on reload", () => {
    let n = 0;
    n = nextConsecutiveReady(n, "ready");
    expect(isAppPageStable(n)).toBe(false);
    n = nextConsecutiveReady(n, "ready");
    expect(isAppPageStable(n)).toBe(true);
  });

  it("resets when the follow-up homepage request fails", () => {
    let n = nextConsecutiveReady(0, "ready");
    n = nextConsecutiveReady(n, "down");
    expect(n).toBe(0);
    expect(isAppPageStable(n)).toBe(false);
  });

  it("does not treat an empty 200 body as a ready homepage", () => {
    expect(classifyAppPageResponse(200, "")).toBe("down");
    expect(classifyAppPageResponse(200, "   ")).toBe("down");
  });

  it("keeps waiting after a JSON.parse 500", () => {
    expect(classifyAppPageResponse(500, "Unexpected end of JSON input")).toBe(
      "down",
    );
  });

  it("accepts a real HTML homepage", () => {
    const html = `<!DOCTYPE html><html><body>${"x".repeat(400)}</body></html>`;
    expect(classifyAppPageResponse(200, html)).toBe("ready");
  });
});
