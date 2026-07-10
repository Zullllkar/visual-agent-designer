import { z } from "zod";
import { generateProjectFromIdea } from "@/lib/agents/orchestrator";
import { ProviderConfigSchema } from "@/lib/providers/config-schema";
import { ProviderRequiredError } from "@/lib/providers/validate";

const InputSchema = z.object({
  idea: z.string().min(2).max(500),
  providerConfig: ProviderConfigSchema,
});

/**
 * POST /api/agents/generate
 * body: { idea: string }
 * returns: ProjectFile
 *
 * Next 16 Route Handler：默认不缓存，符合每次都跑 Agent 工作流的语义。
 */
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

  try {
    const project = await generateProjectFromIdea(
      parsed.data.idea,
      parsed.data.providerConfig
    );
    return Response.json({ project });
  } catch (err) {
    if (err instanceof ProviderRequiredError) {
      return Response.json(
        { error: err.code, message: err.message },
        { status: 400 }
      );
    }
    return Response.json(
      { error: "agent_failed", message: (err as Error).message },
      { status: 500 }
    );
  }
}
