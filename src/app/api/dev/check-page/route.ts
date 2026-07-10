import { CanvasPageSchema } from "@/lib/canvas/schema";
import { runDeterministicChecks, geometryScore } from "@/lib/agents/critic-checks";

/**
 * POST /api/dev/check-page
 * --------------------------------------------------------------
 * 开发期工具端点：直接对一份 CanvasPage 运行确定性几何检查。
 * 用于验证 critic-checks 行为；不依赖 LLM。
 */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = CanvasPageSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid_page", issues: parsed.error.issues },
      { status: 400 }
    );
  }
  const issues = runDeterministicChecks(parsed.data);
  return Response.json({
    issues,
    score: geometryScore(issues),
  });
}
