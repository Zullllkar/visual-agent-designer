import { describe, expect, it } from "vitest";

import { formatRelativeTime, projectCoverSrc } from "./cover";

describe("projectCoverSrc", () => {
  it("skips discarded assets", () => {
    const project = {
      assets: [
        { status: "discarded", src: "data:old" },
        { status: "ready", src: "data:keep" },
      ],
    };
    expect(projectCoverSrc(project)).toBe("data:keep");
  });
});

describe("formatRelativeTime", () => {
  it("uses minutes then days", () => {
    const now = Date.parse("2026-08-19T12:00:00.000Z");
    expect(formatRelativeTime("2026-08-19T11:50:00.000Z", now)).toBe("10 分钟前");
    expect(formatRelativeTime("2026-08-17T12:00:00.000Z", now)).toBe("2 天前");
  });
});
