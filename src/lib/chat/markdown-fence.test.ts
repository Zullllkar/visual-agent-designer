import { describe, expect, it } from "vitest";
import {
  countDiffStats,
  languageBadge,
  parseCodeFenceMeta,
} from "./markdown-fence";

describe("parseCodeFenceMeta", () => {
  it("parses plain language", () => {
    expect(parseCodeFenceMeta("language-typescript")).toEqual({
      language: "typescript",
    });
  });

  it("parses cursor citation fence", () => {
    expect(parseCodeFenceMeta("language-12:15:src/foo.tsx")).toEqual({
      language: "typescript",
      filepath: "src/foo.tsx",
      filename: "foo.tsx",
    });
  });

  it("parses language + path", () => {
    expect(parseCodeFenceMeta("language-tsx src/a.tsx")).toEqual({
      language: "tsx",
      filepath: "src/a.tsx",
      filename: "a.tsx",
    });
  });
});

describe("countDiffStats", () => {
  it("counts unified diff markers", () => {
    expect(
      countDiffStats("+a\n-b\n context\n++keep\n--keep")
    ).toEqual({ added: 1, removed: 1 });
  });
});

describe("languageBadge", () => {
  it("maps common languages", () => {
    expect(languageBadge("typescript")).toBe("TS");
    expect(languageBadge("tsx")).toBe("TSX");
  });
});
