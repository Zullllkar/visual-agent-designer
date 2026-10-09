import { costTracker } from "@/lib/agents/cost-tracker";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const summary = costTracker.getProjectSummary(id);
  const records = costTracker
    .getAllRecords()
    .filter((record) => record.projectId === id)
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 100);
  return Response.json({ summary, records });
}
