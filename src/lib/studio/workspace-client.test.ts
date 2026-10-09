import { describe, expect, it } from "vitest";
import { parseStoredHomeWorkspace } from "./workspace-client";

describe("parseStoredHomeWorkspace", () => {
  it("does not throw when the stored JSON is missing or empty", () => {
    expect(parseStoredHomeWorkspace(null)).toBeNull();
    expect(parseStoredHomeWorkspace("")).toBeNull();
    expect(parseStoredHomeWorkspace("   ")).toBeNull();
  });

  it("reads a saved workspace folder", () => {
    expect(
      parseStoredHomeWorkspace(
        JSON.stringify({ path: "E:/work/cover", label: "cover", projectId: "abc" })
      )
    ).toEqual({
      path: "E:/work/cover",
      label: "cover",
      projectId: "abc",
    });
  });
});
