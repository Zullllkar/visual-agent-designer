import { describe, expect, it } from "vitest";
import { persistThenSubmitJob } from "./persist-then-submit";

describe("persistThenSubmitJob", () => {
  it("persists staged placeholders before the job is queued", async () => {
    const order: string[] = [];
    const job = await persistThenSubmitJob(
      async () => {
        order.push("persist");
      },
      () => {
        order.push("submit");
        return { id: "job-1" };
      }
    );
    expect(order).toEqual(["persist", "submit"]);
    expect(job).toEqual({ id: "job-1" });
  });
});
