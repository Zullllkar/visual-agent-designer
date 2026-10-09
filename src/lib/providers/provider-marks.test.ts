import { describe, expect, it } from "vitest";
import type { ProviderConfig } from "./registry";
import { composerImageSummary, composerLlmSummary, composerModelMarks } from "./provider-marks";

describe("composerModelMarks", () => {
  it("uses brand logos for qwen and a letter for a custom image model", () => {
    const config = {
      llm: {
        kind: "openai-compatible",
        apiKey: "sk-test",
        model: "qwen3.8-flash",
        baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      },
      image: {
        kind: "openai-compatible",
        apiKey: "sk-test",
        model: "tt-image-2",
        baseURL: "https://example.test/v1",
      },
    } as ProviderConfig;

    expect(composerModelMarks(config)).toEqual([
      { kind: "logo", id: "qwen", label: "qwen3.8-flash" },
      { kind: "letter", letter: "T", label: "tt-image-2" },
    ]);
    expect(composerLlmSummary(config)).toEqual({
      name: "qwen3.8-flash",
      mark: { kind: "logo", id: "qwen", label: "qwen3.8-flash" },
    });
    expect(composerImageSummary(config)).toMatchObject({
      name: "tt-image-2",
      mark: { kind: "letter", letter: "T" },
    });
  });

  it("maps official image kinds to logos", () => {
    const config = {
      llm: { kind: "anthropic", apiKey: "sk", model: "claude-sonnet-5" },
      image: { kind: "siliconflow", apiKey: "sk", model: "black-forest-labs/FLUX.1-dev" },
    } as ProviderConfig;

    expect(composerModelMarks(config).map((mark) => mark.kind === "logo" && mark.id)).toEqual([
      "anthropic",
      "siliconflow",
    ]);
  });
});
