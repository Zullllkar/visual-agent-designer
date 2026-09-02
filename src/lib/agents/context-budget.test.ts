import { describe, expect, it } from "vitest";
import {
  isContextLengthError,
  truncateToolResultForLlm,
} from "./context-budget";

describe("isContextLengthError", () => {
  it("detects deepseek context overflow", () => {
    expect(
      isContextLengthError(
        "400 This model's maximum context length is 1048565 tokens. However, you requested 6262944 tokens (6262944 in the messages, 0 in the completion)."
      )
    ).toBe(true);
  });

  it("ignores unrelated errors", () => {
    expect(isContextLengthError("rate limit exceeded")).toBe(false);
  });
});

describe("truncateToolResultForLlm", () => {
  it("strips data-url screenshots from tool payloads", () => {
    const huge = `data:image/png;base64,${"A".repeat(50_000)}`;
    const out = truncateToolResultForLlm({
      ok: true,
      summary: "画布截图成功",
      data: { screenshot: huge, width: 800, height: 600 },
    }) as {
      data: { screenshot: string; width: number };
    };
    expect(out.data.screenshot).toMatch(/^\[omitted/);
    expect(out.data.width).toBe(800);
    expect(JSON.stringify(out).length).toBeLessThan(5_000);
  });
});
