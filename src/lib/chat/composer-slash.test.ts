import { describe, expect, it } from "vitest";
import {
  applySlashSelection,
  buildSlashItems,
  filterSlashItems,
  parseSlashQuery,
  SLASH_COMMANDS,
} from "./composer-slash";

describe("parseSlashQuery", () => {
  it("opens at a leading slash", () => {
    expect(parseSlashQuery("/skill", 6)).toEqual({ start: 0, query: "skill" });
  });

  it("opens after whitespace", () => {
    expect(parseSlashQuery("改这张 /变", 6)).toEqual({ start: 4, query: "变" });
  });

  it("ignores slashes inside urls", () => {
    expect(parseSlashQuery("see http://x", 12)).toBeNull();
  });

  it("closes after a space", () => {
    expect(parseSlashQuery("/foo bar", 8)).toBeNull();
  });
});

describe("filterSlashItems", () => {
  it("filters by label, kind, and hint", () => {
    const items = buildSlashItems({
      assets: [{ id: "a1", prompt: "红底海报", src: "x" }],
      skills: [{ name: "saas-landing", description: "SaaS 落地页", bodyPreview: "" }],
    });
    expect(filterSlashItems("海报", items).some((item) => item.id === "asset-a1")).toBe(
      true,
    );
    expect(filterSlashItems("skill", items).some((item) => item.kind === "skill")).toBe(
      true,
    );
    expect(filterSlashItems("变体", items).some((item) => item.insert?.includes("变体"))).toBe(
      true,
    );
  });
});

describe("applySlashSelection", () => {
  it("removes the slash token and keeps surrounding text", () => {
    expect(applySlashSelection("针对这张 /海报", 5, 8)).toBe("针对这张 ");
  });
});

describe("SLASH_COMMANDS", () => {
  it("exposes Cursor-style shortcut commands", () => {
    expect(SLASH_COMMANDS.map((item) => item.id)).toEqual(
      expect.arrayContaining(["cmd-gen-1", "cmd-variants-2", "cmd-export"]),
    );
  });
});
