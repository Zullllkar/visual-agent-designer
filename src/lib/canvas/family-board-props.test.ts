import { describe, expect, it } from "vitest";

import { familyBoardShapeProps } from "./family-board-props";

describe("familyBoardShapeProps", () => {
  it("accepts old family-board records that omit projectId", () => {
    expect(familyBoardShapeProps.projectId.validate(undefined)).toBeUndefined();
    expect(familyBoardShapeProps.projectId.validate("proj-1")).toBe("proj-1");
  });
});
