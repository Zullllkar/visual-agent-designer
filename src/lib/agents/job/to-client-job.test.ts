import { describe, expect, it } from "vitest";

import { toClientJob } from "./to-client-job";

const DATA_URI = `data:image/png;base64,${"A".repeat(8000)}`;

describe("toClientJob", () => {
  it("drops project payloads, data URIs, and updatedProject from list responses", () => {
    const json = JSON.stringify(
      toClientJob({
        id: "job-1",
        type: "direct_image_generation",
        status: "completed",
        createdAt: 1,
        payload: {
          project: { id: "p1", assets: [{ src: DATA_URI }] },
          request: {
            prompt: "neon alley",
            count: 1,
            referenceImages: [{ src: DATA_URI, name: "ref.png" }],
          },
          pendingAssets: [{ id: "a1", src: DATA_URI }],
        },
        result: {
          succeeded: 1,
          failed: 0,
          updatedProject: { id: "p1", assets: [{ src: DATA_URI }] },
          assets: [{ id: "a1", status: "ready", src: DATA_URI, prompt: "neon alley" }],
        },
        recoverablePayload: {
          request: { referenceImages: [{ src: DATA_URI }] },
        },
      })
    );

    expect(json).not.toContain("data:image");
    expect(json).not.toContain("updatedProject");
    expect(json).not.toContain("AAAA");
    const client = JSON.parse(json) as ReturnType<typeof toClientJob>;
    expect(client.payloadSummary).toMatchObject({
      pendingAssetCount: 1,
      request: { prompt: "neon alley", count: 1, referenceImageCount: 1 },
    });
    expect(client.result).toMatchObject({
      succeeded: 1,
      failed: 0,
      assets: [{ id: "a1", status: "ready", prompt: "neon alley" }],
    });
    expect(json.length).toBeLessThan(800);
  });
});
