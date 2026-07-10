/**
 * GET /api/health
 * 简单的健康检查端点。验证 Next 16 Route Handler 工作正常。
 */
export async function GET() {
  return Response.json({
    ok: true,
    name: "visual-agent-designer",
    stage: "skeleton",
    timestamp: new Date().toISOString(),
  });
}
