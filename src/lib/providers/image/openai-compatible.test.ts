import { describe, expect, it } from "vitest";

import {
  attachReferenceImagesToBody,
  resolveImageApiPath,
  shouldFallbackToGenerations,
  shouldRetryEditsAsMultipart,
  shouldRetryImageHttp,
} from "./openai-compatible";

describe("attachReferenceImagesToBody", () => {
  it("adds image and images for usable references", () => {
    const body: Record<string, unknown> = { prompt: "hero" };
    attachReferenceImagesToBody(body, [
      "data:image/png;base64,abc",
      "https://cdn.example/ref.jpg",
      "data:image/svg+xml,noop",
    ]);
    expect(body.image).toBe("data:image/png;base64,abc");
    expect(body.images).toEqual([
      "data:image/png;base64,abc",
      "https://cdn.example/ref.jpg",
    ]);
  });

  it("leaves body unchanged without usable references", () => {
    const body: Record<string, unknown> = { prompt: "hero" };
    attachReferenceImagesToBody(body, ["/api/assets/p/assets/a.png"]);
    expect(body.image).toBeUndefined();
  });
});

describe("image API path for references", () => {
  it("uses edits when a reference image is present", () => {
    expect(resolveImageApiPath(true)).toBe("/images/edits");
    expect(resolveImageApiPath(false)).toBe("/images/generations");
  });

  it("falls back to generations only when edits is missing", () => {
    expect(shouldFallbackToGenerations(404)).toBe(true);
    expect(shouldFallbackToGenerations(405)).toBe(true);
    expect(shouldFallbackToGenerations(400)).toBe(false);
  });

  it("retries official OpenAI-style multipart after JSON edits reject", () => {
    expect(shouldRetryEditsAsMultipart(400)).toBe(true);
    expect(shouldRetryEditsAsMultipart(404)).toBe(false);
  });
});

describe("shouldRetryImageHttp", () => {
  it("retries rate limits only, never timeouts or 5xx after POST", () => {
    const timeout = new Error("timeout after 180000ms");
    const rate = new Error("HTTP 429: busy") as Error & { status?: number };
    rate.status = 429;
    const server = new Error("HTTP 502: bad gateway") as Error & { status?: number };
    server.status = 502;
    expect(shouldRetryImageHttp(timeout)).toBe(false);
    expect(shouldRetryImageHttp(rate)).toBe(true);
    expect(shouldRetryImageHttp(server)).toBe(false);
  });
});
