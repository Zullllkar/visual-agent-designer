/**
 * POST /api/handoff/zip
 * --------------------------------------------------------------
 * 服务端编译 Handoff artifact 并返回 zip 二进制流。
 * Chat export_handoff 与 HandoffDialog 共用。
 *
 * @author：wangjunhua
 */

import { z } from "zod";
import { ProjectFileSchema } from "@/lib/project/schema";
import { HandoffAgent } from "@/lib/agents/handoff-agent";
import { zipHandoffArtifact } from "@/lib/handoff/zip";
import type { HandoffTarget } from "@/lib/handoff/types";

const InputSchema = z.object({
  project: ProjectFileSchema,
  target: z
    .enum(["cursor", "claude-code", "codex", "markdown"])
    .optional()
    .default("markdown"),
});

export async function POST(req: Request) {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = InputSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid_input", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const { project, target } = parsed.data;
  const ctx = {
    projectId: project.id,
    scratch: {},
    providers: {
      llm: { name: "handoff-zip-route", generateText: async () => ({ text: "" }) },
      image: {
        name: "handoff-zip-route",
        async generateImage() {
          return { imageUrl: "", model: "none" };
        },
      },
      visionCritic: false,
    },
    skill: null,
    designSystem: null,
  };

  try {
    const result = await HandoffAgent.run(
      { project, target: target as HandoffTarget["name"] },
      ctx
    );
    const blob = await zipHandoffArtifact(result.artifact);
    const buffer = Buffer.from(await blob.arrayBuffer());

    return new Response(buffer, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${project.slug || project.id}.${target}.handoff.zip"`,
      },
    });
  } catch (err) {
    return Response.json(
      { error: "handoff_failed", message: (err as Error).message },
      { status: 500 }
    );
  }
}
