import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { resolveDesktopPaths, sidecarRoot } = require("./paths.cjs") as {
  resolveDesktopPaths: (app: { getPath: (name: string) => string }) => {
    userData: string;
    vadRoot: string;
    checkpoints: string;
    logsDir: string;
    windowState: string;
  };
  sidecarRoot: (
    packaged: boolean,
    repoRoot: string,
    resourcesPath: string
  ) => string | null;
};

describe("resolveDesktopPaths", () => {
  it("puts project data under userData", () => {
    const app = { getPath: () => "C:/Users/me/AppData/Roaming/VAD" };
    const paths = resolveDesktopPaths(app, {});
    expect(paths.vadRoot).toBe(path.join(app.getPath("userData"), "vad"));
    expect(paths.checkpoints).toBe(
      path.join(app.getPath("userData"), "vad-data")
    );
    expect(paths.logsDir).toBe(path.join(app.getPath("userData"), "logs"));
  });
});

describe("sidecarRoot", () => {
  it("is null while developing from source", () => {
    expect(sidecarRoot(false, "E:/repo", "E:/res")).toBeNull();
  });

  it("points at extraResources when packaged", () => {
    expect(sidecarRoot(true, "E:/repo", "E:/res")).toBe(
      path.join("E:/res", "sidecar")
    );
  });
});
