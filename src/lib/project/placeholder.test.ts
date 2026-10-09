import { describe, expect, it } from "vitest";

import { createPlaceholderProject } from "./placeholder";

describe("createPlaceholderProject", () => {
  it("stores the selected visual target", () => {
    const project = createPlaceholderProject("abc123", "像素仙侠门派山门立绘", {
      targetId: "game-art",
      targetLocked: true,
    });
    expect(project.targetId).toBe("game-art");
    expect(project.targetLocked).toBe(true);
  });

  it("defaults a missing target to undefined so resolve can mark 未点选", () => {
    const project = createPlaceholderProject("abc123", "随便做个东西");
    expect(project.targetId).toBeUndefined();
  });

  it("stores the selected project Skill binding", () => {
    const project = createPlaceholderProject("abc123", "远程协作工具官网", {
      targetId: "ui-visual",
      skillId: "saas-landing",
      skillVersion: "0.1.0",
      designSystemId: "linear-like",
    });

    expect(project.skillId).toBe("saas-landing");
    expect(project.skillVersion).toBe("0.1.0");
    expect(project.designSystemId).toBe("linear-like");
  });

  it("binds a user workspace folder so files are not stored in the app data dir", () => {
    const project = createPlaceholderProject("abc123", "健身训练首页", {
      workspacePath: "E:/work/fitness-app",
    });
    expect(project.workspacePath).toBe("E:/work/fitness-app");
  });
});
