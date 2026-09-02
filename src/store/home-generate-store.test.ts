import { describe, expect, it } from "vitest";

import { planHomeJobOnCanvas, type HomeGenerateJob } from "./home-generate-store";

const job: HomeGenerateJob = {
  projectId: "p1",
  idea: "知识卡：三步讲清一个点",
  providerConfig: {} as HomeGenerateJob["providerConfig"],
  targetId: "social-cover",
};

describe("planHomeJobOnCanvas", () => {
  it("sends the new-page idea as chat text without leaving it in the canvas composer", () => {
    const start = planHomeJobOnCanvas(job);
    expect(start.sendText).toBe("知识卡：三步讲清一个点");
    expect(start.composerValue).toBe("");
  });
});
