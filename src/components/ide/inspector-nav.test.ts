import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("inspector navigation", () => {
  it("keeps two canvas destinations and moves the rest into a project menu", () => {
    const src = readFileSync(resolve(process.cwd(), "src/components/ide/ide-shell.tsx"), "utf8");
    expect(src).toMatch(/label: "素材"/);
    expect(src).toMatch(/label: "页面"/);
    expect(src).toMatch(/label: "大纲"/);
    expect(src).toMatch(/label: "导出"/);
    expect(src).toMatch(/aria-label="项目"/);
    expect(src).not.toMatch(/更多/);
    expect(src).not.toMatch(/vad-inspector-more/);
  });
});
