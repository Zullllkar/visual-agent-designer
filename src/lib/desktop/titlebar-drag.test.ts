import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("desktop titlebar drag regions", () => {
  it("keeps the titlebar grid draggable and limits no-drag to controls", () => {
    const css = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");
    const titlebar = css.match(/\.desktop-titlebar \{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(titlebar).toMatch(/-webkit-app-region:\s*drag/);
    expect(css).toMatch(/\.desktop-titlebar \[data-no-drag\][\s\S]*?-webkit-app-region:\s*no-drag/);
    expect(css).not.toMatch(/\.desktop-titlebar-left,\s*\.desktop-titlebar-center,\s*\.desktop-titlebar-actions,\s*\.desktop-titlebar \[data-no-drag\]/);
  });
});
