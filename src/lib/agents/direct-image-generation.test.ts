import { describe, expect, it } from "vitest";

import {
  buildDirectPendingAssets,
  runDirectImageGenerationBatch,
  type DirectImageGenerationRequest,
} from "./direct-image-generation";
import type { ImageProvider } from "@/lib/providers/image/types";

describe("runDirectImageGenerationBatch", () => {
  const request: DirectImageGenerationRequest = {
    prompt: "product hero image cool",
    prompts: [
      "product hero image cool",
      "product hero image warm",
      "product hero image overcast",
    ],
    count: 3,
    width: 512,
    height: 512,
  };

  it("does not clone one prompt into N pending cards", () => {
    const pending = buildDirectPendingAssets(
      {
        prompt: "same sentence",
        count: 3,
        width: 512,
        height: 512,
      },
      "same-prompt"
    );
    expect(pending).toHaveLength(1);
    expect(pending[0]?.prompt).toBe("same sentence");
  });

  it("uses Windows-safe pending ids without colons", () => {
    const pending = buildDirectPendingAssets(request, "9c3982bea0");
    expect(pending.map((asset) => asset.id)).toEqual([
      "pending-direct-9c3982bea0-0",
      "pending-direct-9c3982bea0-1",
      "pending-direct-9c3982bea0-2",
    ]);
    for (const asset of pending) {
      expect(asset.id).not.toContain(":");
    }
  });

  it("limits concurrency and replaces pending assets with generated assets", async () => {
    let active = 0;
    let maxActive = 0;
    const provider: ImageProvider = {
      name: "test",
      async generateImage() {
        active++;
        maxActive = Math.max(maxActive, active);
        await delay(5);
        active--;
        return { imageUrl: `data:image/png;base64,${maxActive}`, model: "test" };
      },
    };
    const pendingAssets = buildDirectPendingAssets(request, "batch-a");

    const result = await runDirectImageGenerationBatch({
      image: provider,
      input: request,
      initialAssets: [],
      pendingAssets,
      concurrency: 2,
    });

    expect(maxActive).toBeLessThanOrEqual(2);
    expect(result.succeeded).toBe(3);
    expect(result.failed).toBe(0);
    expect(result.assets).toHaveLength(3);
    expect(result.assets.every((asset) => asset.status === "candidate")).toBe(true);
    expect(result.assets.map((a) => a.id).sort()).toEqual(
      pendingAssets.map((a) => a.id).sort()
    );
  });

  it("marks individual failed images without failing the full batch", async () => {
    let calls = 0;
    const provider: ImageProvider = {
      name: "test",
      async generateImage() {
        calls++;
        if (calls === 2) throw new Error("provider failed");
        return { imageUrl: `data:image/png;base64,${calls}`, model: "test" };
      },
    };
    const pendingAssets = buildDirectPendingAssets(request, "batch-b");

    const result = await runDirectImageGenerationBatch({
      image: provider,
      input: request,
      initialAssets: [],
      pendingAssets,
      concurrency: 1,
    });

    expect(result.succeeded).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.assets.some((asset) => asset.status === "failed")).toBe(true);
    expect(result.errors).toEqual(["provider failed"]);
  });

  it("keeps a generated asset when persist callback throws", async () => {
    const provider: ImageProvider = {
      name: "test",
      async generateImage() {
        return { imageUrl: "data:image/png;base64,ok", model: "test" };
      },
    };
    const pendingAssets = buildDirectPendingAssets(
      { ...request, prompts: [request.prompt], count: 1 },
      "batch-persist"
    );

    const result = await runDirectImageGenerationBatch({
      image: provider,
      input: { ...request, prompts: [request.prompt], count: 1 },
      initialAssets: [],
      pendingAssets,
      onAssetsReady: async () => {
        throw new Error("persist exploded");
      },
    });

    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.assets[0]?.status).toBe("candidate");
    expect(result.assets[0]?.src).toBe("data:image/png;base64,ok");
    expect(result.errors).toEqual(["persist exploded"]);
  });

  it("marks unfinished pending assets as cancelled when aborted", async () => {
    const controller = new AbortController();
    const provider: ImageProvider = {
      name: "test",
      async generateImage() {
        controller.abort();
        const error = new Error("aborted");
        error.name = "AbortError";
        throw error;
      },
    };
    const pendingAssets = buildDirectPendingAssets(request, "batch-c");

    const result = await runDirectImageGenerationBatch({
      image: provider,
      input: request,
      initialAssets: [],
      pendingAssets,
      signal: controller.signal,
      concurrency: 1,
    });

    expect(result.succeeded).toBe(0);
    expect(result.cancelled).toBe(3);
    expect(result.assets.every((asset) => asset.status === "cancelled")).toBe(true);
  });

  it("preserves edit metadata on pending and generated assets", async () => {
    const editRequest: DirectImageGenerationRequest = {
      ...request,
      prompts: [request.prompt],
      count: 1,
      parentAssetId: "asset-parent",
      editInstruction: "replace the marked button",
      editRegion: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 },
      role: "hero",
      referenceImages: ["data:image/png;base64,ref"],
    };
    const provider: ImageProvider = {
      name: "test",
      async generateImage() {
        return { imageUrl: "data:image/png;base64,out", model: "test" };
      },
    };
    const pendingAssets = buildDirectPendingAssets(editRequest, "batch-edit");

    expect(pendingAssets[0]).toMatchObject({
      parentAssetId: "asset-parent",
      editInstruction: "replace the marked button",
      editRegion: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 },
      role: "hero",
      source: "edited",
    });

    const result = await runDirectImageGenerationBatch({
      image: provider,
      input: editRequest,
      initialAssets: [],
      pendingAssets,
    });

    expect(result.generatedAssets[0]).toMatchObject({
      parentAssetId: "asset-parent",
      editInstruction: "replace the marked button",
      editRegion: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 },
      role: "hero",
      source: "edited",
    });
  });
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
