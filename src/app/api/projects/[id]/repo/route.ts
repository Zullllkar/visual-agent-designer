/**
 * POST   /api/projects/[id]/repo  关联仓库并立即同步
 * PATCH  /api/projects/[id]/repo  按已关联路径再同步一次
 * DELETE /api/projects/[id]/repo  取消关联（不删除仓库里已写入的文件）
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { isSafeProjectId } from "@/lib/studio/project-actions";
import {
  loadMergedProjectFromVad,
  saveProjectToVad,
} from "@/lib/vad/storage";
import { syncHandoffBundle } from "@/lib/vad/handoff-sync";
import { validateRepoPath } from "@/lib/bridge/repo-path";
import { syncLinkedRepo, toLinkedRepo } from "@/lib/bridge/repo-sync";

const LinkBodySchema = z.object({
  path: z.string().min(1),
  mountDir: z.string().optional(),
  writeAgentFiles: z.boolean().optional(),
  writeMcpConfig: z.boolean().optional(),
});

async function paramsId(ctx: { params: Promise<{ id: string }> }): Promise<string | NextResponse> {
  const { id } = await ctx.params;
  if (!isSafeProjectId(id)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }
  return id;
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const idOrErr = await paramsId(ctx);
  if (idOrErr instanceof NextResponse) return idOrErr;
  const id = idOrErr;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = LinkBodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input", issues: parsed.error.issues }, { status: 400 });
  }

  const checked = validateRepoPath(parsed.data.path, { mountDir: parsed.data.mountDir });
  if (!checked.ok) {
    return NextResponse.json({ error: "invalid_repo", message: checked.error }, { status: 400 });
  }

  const project = await loadMergedProjectFromVad(id);
  if (!project) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const linked = toLinkedRepo(checked, {
    writeAgentFiles: parsed.data.writeAgentFiles !== false,
    writeMcpConfig: parsed.data.writeMcpConfig !== false,
  });
  const saved = await saveProjectToVad({
    ...project,
    linkedRepo: linked,
    updatedAt: new Date().toISOString(),
  });

  await syncHandoffBundle(saved).catch((err) => {
    console.warn("[link-repo] internal handoff sync failed:", err);
  });
  const sync = await syncLinkedRepo(saved);
  const withStatus = await saveProjectToVad({
    ...saved,
    linkedRepo: {
      ...linked,
      lastSyncedAt: sync.ok ? new Date().toISOString() : undefined,
      lastError: sync.ok ? undefined : sync.error,
    },
  });

  return NextResponse.json({ ok: sync.ok, project: withStatus, sync });
}

export async function PATCH(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const idOrErr = await paramsId(ctx);
  if (idOrErr instanceof NextResponse) return idOrErr;
  const project = await loadMergedProjectFromVad(idOrErr);
  if (!project) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!project.linkedRepo?.path) {
    return NextResponse.json({ error: "not_linked", message: "Project has no linked repository." }, { status: 409 });
  }

  await syncHandoffBundle(project).catch((err) => {
    console.warn("[sync-repo] internal handoff sync failed:", err);
  });
  const sync = await syncLinkedRepo(project);
  const saved = await saveProjectToVad({
    ...project,
    linkedRepo: {
      ...project.linkedRepo,
      lastSyncedAt: sync.ok ? new Date().toISOString() : project.linkedRepo.lastSyncedAt,
      lastError: sync.ok ? undefined : sync.error,
    },
    updatedAt: new Date().toISOString(),
  });
  return NextResponse.json({ ok: sync.ok, project: saved, sync });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const idOrErr = await paramsId(ctx);
  if (idOrErr instanceof NextResponse) return idOrErr;
  const project = await loadMergedProjectFromVad(idOrErr);
  if (!project) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const saved = await saveProjectToVad({
    ...project,
    linkedRepo: undefined,
    updatedAt: new Date().toISOString(),
  });
  return NextResponse.json({ ok: true, project: saved });
}
