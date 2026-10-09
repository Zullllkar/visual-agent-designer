import { describe, expect, it } from "vitest";
import {
  buildImageLedgerRecord,
  buildLlmLedgerRecord,
  mergeImageRecords,
  summarizeReferences,
  sumLlmTokens,
} from "./ledger";

describe("generation ledger", () => {
  it("keeps image model, prompt, size, and reference shape without data urls", () => {
    const record = buildImageLedgerRecord("img-1", {
      model: "gpt-image-2",
      prompt: "a porcelain kettle on an aluminum desk",
      negativePrompt: "blur",
      width: 1024,
      height: 768,
      referenceImages: [
        "data:image/png;base64,AAAA",
        "https://cdn.example/ref.png",
      ],
      referenceIds: ["ref-1"],
      seed: "42",
      durationMs: 3200,
      status: "succeeded",
      assetId: "asset-1",
      at: "2026-10-09T02:00:00.000Z",
    });

    expect(record).toMatchObject({
      kind: "image",
      model: "gpt-image-2",
      prompt: "a porcelain kettle on an aluminum desk",
      width: 1024,
      height: 768,
      seed: "42",
      assetId: "asset-1",
      referenceIds: ["ref-1"],
    });
    expect(record.references).toEqual([
      { kind: "inline", mime: "image/png" },
      { kind: "url", src: "https://cdn.example/ref.png" },
    ]);
    expect(JSON.stringify(record)).not.toContain("base64");
  });

  it("records llm model and token totals", () => {
    const record = buildLlmLedgerRecord("llm-1", {
      model: "deepseek-v4",
      provider: "deepseek",
      purpose: "对话",
      inputTokens: 1200,
      outputTokens: 340,
      durationMs: 1800,
      at: "2026-10-09T02:01:00.000Z",
    });
    expect(record.totalTokens).toBe(1540);
    expect(sumLlmTokens([record, { ...record, id: "llm-2", inputTokens: 10, outputTokens: 5, totalTokens: 15 }])).toEqual({
      calls: 2,
      inputTokens: 1210,
      outputTokens: 345,
      totalTokens: 1555,
    });
  });

  it("shows past assets once, even when the live ledger already has that shot", () => {
    const ledger = [
      buildImageLedgerRecord("live-1", {
        model: "gpt-image-2",
        prompt: "kettle",
        width: 512,
        height: 512,
        status: "succeeded",
        assetId: "asset-1",
        at: "2026-10-09T02:02:00.000Z",
      }),
    ];
    const merged = mergeImageRecords(ledger, [
      {
        id: "asset-1",
        prompt: "kettle",
        model: "gpt-image-2",
        width: 512,
        height: 512,
        createdAt: "2026-10-09T02:02:01.000Z",
      },
      {
        id: "asset-2",
        prompt: "older cup",
        model: "flux",
        width: 256,
        height: 256,
        createdAt: "2026-10-08T02:02:00.000Z",
        referenceAssetIds: ["ref-9"],
      },
    ]);
    expect(merged.map((item) => item.assetId)).toEqual(["asset-1", "asset-2"]);
    expect(merged[1]?.referenceIds).toEqual(["ref-9"]);
  });

  it("drops data urls from reference summaries", () => {
    expect(summarizeReferences(["data:image/jpeg;base64,ZZZ"])).toEqual([
      { kind: "inline", mime: "image/jpeg" },
    ]);
  });
});
