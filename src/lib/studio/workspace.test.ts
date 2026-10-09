import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  isInternalAppDataPath,
  validateWorkspacePath,
  workspaceFolderName,
  workspaceSidecarDir,
} from "./workspace";

describe("workspaceSidecarDir", () => {
  it("keeps app files in a .vibeboard sidecar, not the user's folder root", () => {
    expect(workspaceSidecarDir("E:/work/fitness-app")).toBe(
      path.join("E:/work/fitness-app", ".vibeboard"),
    );
  });
});

describe("workspaceFolderName", () => {
  it("uses the last path segment as the visible project name", () => {
    expect(workspaceFolderName("E:/work/fitness-app")).toBe("fitness-app");
    expect(workspaceFolderName("E:/work/fitness-app/")).toBe("fitness-app");
  });
});

describe("isInternalAppDataPath", () => {
  it("rejects the app .vad data root so generation cannot land in the repo", () => {
    expect(
      isInternalAppDataPath("E:/repo/.vad/projects/abc", "E:/repo/.vad"),
    ).toBe(true);
    expect(isInternalAppDataPath("E:/work/fitness-app", "E:/repo/.vad")).toBe(
      false,
    );
  });
});

describe("validateWorkspacePath", () => {
  it("requires an absolute path outside the app data directory", () => {
    expect(
      validateWorkspacePath("work/fitness", {
        vadRoot: "E:/repo/.vad",
        mustExist: false,
      }).ok,
    ).toBe(false);
    expect(
      validateWorkspacePath("E:/repo/.vad/projects/x", {
        vadRoot: "E:/repo/.vad",
        mustExist: false,
      }).ok,
    ).toBe(false);
    expect(
      validateWorkspacePath("E:/work/fitness-app", {
        vadRoot: "E:/repo/.vad",
        mustExist: false,
      }),
    ).toEqual({ ok: true, path: path.resolve("E:/work/fitness-app") });
  });
});
