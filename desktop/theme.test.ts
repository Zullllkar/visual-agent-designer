import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { loadUiTheme, saveUiTheme, windowChrome, normalizeTheme } = require(
  "./theme.cjs"
) as {
  loadUiTheme: (file: string) => "light" | "dark";
  saveUiTheme: (file: string, theme: string) => void;
  windowChrome: (theme: string) => { background: string };
  normalizeTheme: (theme: string) => "light" | "dark";
};

describe("ui theme persist", () => {
  it("treats unknown values as light", () => {
    expect(normalizeTheme("system")).toBe("light");
    expect(normalizeTheme("dark")).toBe("dark");
  });

  it("round-trips a saved theme", () => {
    const file = path.join(os.tmpdir(), `vad-ui-theme-${Date.now()}.json`);
    saveUiTheme(file, "dark");
    expect(loadUiTheme(file)).toBe("dark");
    expect(windowChrome("dark").background).toBe("#161412");
    fs.unlinkSync(file);
  });

  it("defaults to light when the file is missing", () => {
    expect(loadUiTheme(path.join(os.tmpdir(), "vad-missing-theme.json"))).toBe(
      "light"
    );
  });
});
