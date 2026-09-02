import { describe, expect, it } from "vitest";

import { resolveTheme } from "./preferences";

describe("resolveTheme", () => {
  it("passes light and dark through", () => {
    expect(resolveTheme("light")).toBe("light");
    expect(resolveTheme("dark")).toBe("dark");
  });

  it("does not follow the operating system", () => {
    expect(resolveTheme("light")).toBe("light");
  });
});
