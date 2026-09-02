import { describe, expect, it } from "vitest";

import { isChatTechnicalNoise } from "@/lib/chat/chat-content-noise";
import { formatChatValue } from "@/lib/chat/format-chat-value";

describe("isChatTechnicalNoise", () => {
  it("flags tool result envelopes", () => {
    expect(
      isChatTechnicalNoise(
        JSON.stringify({
          ok: true,
          summary: "已为素材生成 1 张变体",
          data: { candidateAssetIds: ["a"] },
        })
      )
    ).toBe(true);
  });

  it("flags langchain dumps", () => {
    expect(
      isChatTechnicalNoise(
        JSON.stringify({
          input: "keep layout",
          versions: { "@langchain/core": "1.2.2" },
          additional_kwargs: {},
          response_metadata: {},
          id: "c86f9272-6e67-48db-8252-5d59046d1706",
        })
      )
    ).toBe(true);
  });

  it("allows normal assistant prose", () => {
    expect(isChatTechnicalNoise("好的，切换任务：生成 1 个变体")).toBe(false);
  });
});

describe("formatChatValue tool envelopes", () => {
  it("prefers summary over raw JSON dump", () => {
    expect(
      formatChatValue({
        ok: true,
        summary: "已为素材生成 1 张变体",
        data: { candidateAssetIds: ["a"] },
      })
    ).toBe("已为素材生成 1 张变体");
  });
});
