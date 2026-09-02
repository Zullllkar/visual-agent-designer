import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  resolveCheckpointsDir,
  resolveProjectRoot,
  resolveVadRoot,
} from "./paths";

describe("resolveVadRoot", () => {
  it("defaults to cwd/.vad", () => {
    expect(resolveVadRoot({}, "E:/repo")).toBe(path.join("E:/repo", ".vad"));
  });

  it("honors VAD_ROOT", () => {
    expect(
      resolveVadRoot({ VAD_ROOT: "C:/Users/me/AppData/Roaming/VAD/vad" }, "E:/repo")
    ).toBe("C:/Users/me/AppData/Roaming/VAD/vad");
  });
});

describe("resolveCheckpointsDir", () => {
  it("defaults to cwd/.vad-data", () => {
    expect(resolveCheckpointsDir({}, "E:/repo")).toBe(
      path.join("E:/repo", ".vad-data")
    );
  });

  it("honors VAD_CHECKPOINTS_DIR", () => {
    expect(
      resolveCheckpointsDir({ VAD_CHECKPOINTS_DIR: "D:/data/ck" }, "E:/repo")
    ).toBe("D:/data/ck");
  });
});

describe("resolveProjectRoot", () => {
  it("defaults to cwd", () => {
    expect(resolveProjectRoot({}, "E:/repo")).toBe("E:/repo");
  });

  it("honors VAD_PROJECT_ROOT", () => {
    expect(resolveProjectRoot({ VAD_PROJECT_ROOT: "E:/app" }, "E:/repo")).toBe(
      "E:/app"
    );
  });
});
