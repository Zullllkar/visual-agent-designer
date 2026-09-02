import { describe, expect, it } from "vitest";

import { desktopTitleForPath, parseProjectIdFromPath } from "./project-path";

describe("parseProjectIdFromPath", () => {
  it("reads a canvas project id", () => {
    expect(parseProjectIdFromPath("/projects/lc-abc")).toBe("lc-abc");
  });

  it("ignores list and new", () => {
    expect(parseProjectIdFromPath("/projects")).toBeNull();
    expect(parseProjectIdFromPath("/projects/new")).toBeNull();
  });
});

describe("desktopTitleForPath", () => {
  it("names common routes", () => {
    expect(desktopTitleForPath("/")).toBe("Vibeboard");
    expect(desktopTitleForPath("/projects")).toBe("Vibeboard");
    expect(desktopTitleForPath("/projects/new")).toBe("Vibeboard");
    expect(desktopTitleForPath("/projects/p1")).toBe("画布");
  });
});
