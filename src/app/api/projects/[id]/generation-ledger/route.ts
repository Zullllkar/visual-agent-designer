import { readGenerationLedger } from "@/lib/generation/ledger-store";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const records = await readGenerationLedger(id);
  return Response.json({ projectId: id, records });
}
