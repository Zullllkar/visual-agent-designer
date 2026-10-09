import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { loadUiTheme, saveUiTheme, windowChrome, normalizeTheme, titleBarOverlayOptions } =
  require("./theme.cjs") as {
    loadUiTheme: (file: string) => "light" | "dark";
    saveUiTheme: (file: string, theme: string) => void;
    windowChrome: (theme: string) => {
      background: string;
      overlay: string;
      symbol: string;
      accent?: string;
    };
    normalizeTheme: (theme: string) => "light" | "dark";
    titleBarOverlayOptions: (
      theme: string,
      scrim?: boolean,
    ) => { color: string; symbolColor: string; height: number };
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
    expect(windowChrome("dark").background).toBe("#0e0f12");
    expect(windowChrome("light").background).toBe("#edeef1");
    expect(windowChrome("light").overlay).toBe("#edeef1");
    expect(windowChrome("dark").overlay).toBe("#0e0f12");
    expect(windowChrome("light").accent).toBe("#141416");
    fs.unlinkSync(file);
  });

  it("keeps native caption buttons on the shell color", () => {
    expect(titleBarOverlayOptions("light")).toEqual({
      color: "#edeef1",
      symbolColor: "#141416",
      height: 40,
    });
    expect(titleBarOverlayOptions("dark")).toEqual({
      color: "#0e0f12",
      symbolColor: "#f2f3f5",
      height: 40,
    });
    expect(titleBarOverlayOptions("light", true)).toEqual({
      color: "#00000000",
      symbolColor: "#f4f4f5",
      height: 40,
    });
  });

  it("defaults to light when the file is missing", () => {
    expect(loadUiTheme(path.join(os.tmpdir(), "vad-missing-theme.json"))).toBe(
      "light"
    );
  });
});
