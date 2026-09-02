import { describe, expect, it } from "vitest";
import { decideStartupTarget } from "./startup";

describe("decideStartupTarget", () => {
  it("returns last project path once on home", () => {
    expect(
      decideStartupTarget({
        preference: "last",
        lastProjectId: "abc12XYZ",
        alreadyApplied: false,
        currentPath: "/",
      })
    ).toBe("/projects/abc12XYZ");
  });

  it("does nothing when user chose home, already applied, or unsafe id", () => {
    expect(
      decideStartupTarget({
        preference: "home",
        lastProjectId: "abc12XYZ",
        alreadyApplied: false,
        currentPath: "/",
      })
    ).toBeNull();
    expect(
      decideStartupTarget({
        preference: "last",
        lastProjectId: "abc12XYZ",
        alreadyApplied: true,
        currentPath: "/",
      })
    ).toBeNull();
    expect(
      decideStartupTarget({
        preference: "last",
        lastProjectId: "../x",
        alreadyApplied: false,
        currentPath: "/",
      })
    ).toBeNull();
  });
});
