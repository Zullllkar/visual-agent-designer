import { describe, expect, it } from "vitest";
import { isSameActiveImageJob } from "./image-job-dedupe";

describe("isSameActiveImageJob", () => {
  it("matches the same approval even when only request.width is 1080x1440", () => {
    expect(
      isSameActiveImageJob(
        {
          type: "direct_image_generation",
          status: "running",
          payload: {
            approvalId: "run-1:generate_images",
            request: {
              prompt: "GPT-6 cover",
              count: 1,
              width: 1080,
              height: 1440,
            },
          },
        },
        {
          approvalId: "run-1:generate_images",
          prompt: "GPT-6 cover",
          count: 1,
          width: 1080,
          height: 1440,
        }
      )
    ).toBe(true);
  });

  it("matches a Xiaohongshu cover by request size when approvalId was not stored", () => {
    expect(
      isSameActiveImageJob(
        {
          type: "direct_image_generation",
          status: "running",
          payload: {
            request: {
              prompt: "GPT-6 cover",
              count: 1,
              width: 1080,
              height: 1440,
            },
          },
        },
        {
          prompt: "GPT-6 cover",
          count: 1,
          width: 1080,
          height: 1440,
        }
      )
    ).toBe(true);
  });

  it("does not treat a finished job as still active", () => {
    expect(
      isSameActiveImageJob(
        {
          type: "direct_image_generation",
          status: "completed",
          payload: { approvalId: "run-1:generate_images" },
        },
        { approvalId: "run-1:generate_images", prompt: "cover", count: 1, width: 1080, height: 1440 }
      )
    ).toBe(false);
  });
});
