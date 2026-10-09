import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { splashDataUrl } = require("./splash.cjs") as {
  splashDataUrl: (
    message: string,
    chrome?: { background: string; ink: string; accent?: string }
  ) => string;
};

describe("splashDataUrl", () => {
  it("embeds the official selection-frame logo and loading motion", () => {
    const url = splashDataUrl("正在编译界面", {
      background: "#fbfbfa",
      ink: "#1a1916",
      accent: "#d06b5c",
    });
    const html = decodeURIComponent(url.replace("data:text/html;charset=utf-8,", ""));
    expect(html).toContain('viewBox="0 0 32 32"');
    expect(html).toContain('class="handle');
    expect(html).toContain("@keyframes draw");
    expect(html).toContain("@keyframes ants");
    expect(html).toContain("@keyframes shimmer");
    expect(html).not.toContain("@keyframes spin");
    expect(html).toContain("splash-msg");
    expect(html).toContain("正在编译界面");
    expect(html).toContain("#d06b5c");
    expect(html).toContain('x="13.6"');
  });

  it("escapes user-facing status text", () => {
    const url = splashDataUrl('<script>alert(1)</script>');
    const html = decodeURIComponent(url.replace("data:text/html;charset=utf-8,", ""));
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>alert");
  });
});
