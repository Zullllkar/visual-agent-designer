import { describe, expect, it } from "vitest";
import { FILE_MENU_COMMANDS, STUDIO_SHORTCUTS } from "./commands";

describe("FILE_MENU_COMMANDS", () => {
  it("starts with product actions before folders", () => {
    expect(FILE_MENU_COMMANDS.map((item) => item.id)).toEqual([
      "new-brief",
      "open-settings",
      "open-gallery",
      "open-vad-root",
      "open-logs",
      "quit",
    ]);
  });
});

describe("STUDIO_SHORTCUTS", () => {
  it("covers home and canvas keys", () => {
    const actions = STUDIO_SHORTCUTS.map((row) => row.action);
    expect(actions).toContain("提交 Brief，打开画布");
    expect(actions).toContain("搜索本地项目");
    expect(actions).toContain("打开设置");
    expect(actions).toContain("画布放大");
    expect(actions).toContain("画布缩小");
    expect(actions).toContain("画布实际大小");
  });
});
