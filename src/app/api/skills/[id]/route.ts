import { getAllSkillRegistry, invalidateRegistry } from "@/lib/skills/registry";
import {
  assertSafeSkillId,
  deleteUserSkill,
  parseSkillDocument,
  setUserSkillEnabled,
  writeUserSkillDocument,
} from "@/lib/skills/storage";
import { listProjectsFromVad } from "@/lib/vad/storage";

function toDetail(skill: Awaited<ReturnType<typeof getAllSkillRegistry>>[number]) {
  return {
    ...skill.manifest,
    sourcePath: skill.sourcePath,
    bodyPreview: skill.body.slice(0, 300),
    body: skill.body,
    raw: skill.raw,
    origin: skill.origin,
    enabled: skill.enabled,
  };
}

async function findSkill(id: string) {
  const all = await getAllSkillRegistry();
  return all.find((skill) => skill.manifest.name === id) ?? null;
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    assertSafeSkillId(id);
    const skill = await findSkill(id);
    if (!skill) return Response.json({ error: "Skill 不存在" }, { status: 404 });
    const projects = await listProjectsFromVad();
    return Response.json({
      skill: toDetail(skill),
      references: projects
        .filter((project) => project.skillId === id)
        .map((project) => ({ id: project.id, title: project.title })),
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Skill 读取失败" },
      { status: 400 },
    );
  }
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    assertSafeSkillId(id);
    const current = await findSkill(id);
    if (!current) return Response.json({ error: "Skill 不存在" }, { status: 404 });
    if (current.origin !== "user") {
      return Response.json({ error: "内置 Skill 为只读资源" }, { status: 403 });
    }
    const payload = (await request.json()) as {
      raw?: string;
      enabled?: boolean;
    };
    if (typeof payload.raw === "string") {
      const parsed = parseSkillDocument(payload.raw);
      if (parsed.manifest.name !== id) {
        return Response.json({ error: "Skill ID 创建后不可修改，请使用复制功能" }, { status: 409 });
      }
      await writeUserSkillDocument(parsed.raw, { overwrite: true });
    }
    if (typeof payload.enabled === "boolean") {
      await setUserSkillEnabled(id, payload.enabled);
    }
    invalidateRegistry();
    const updated = await findSkill(id);
    return Response.json({ skill: updated ? toDetail(updated) : null });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Skill 更新失败" },
      { status: 400 },
    );
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    assertSafeSkillId(id);
    const current = await findSkill(id);
    if (!current) return Response.json({ error: "Skill 不存在" }, { status: 404 });
    if (current.origin !== "user") {
      return Response.json({ error: "内置 Skill 不能删除" }, { status: 403 });
    }
    const references = (await listProjectsFromVad()).filter((project) => project.skillId === id);
    if (references.length > 0) {
      return Response.json(
        {
          error: "该 Skill 正被项目使用，请先为这些项目更换 Skill",
          references: references.map((project) => ({
            id: project.id,
            title: project.title,
          })),
        },
        { status: 409 },
      );
    }
    await deleteUserSkill(id);
    invalidateRegistry();
    return Response.json({ success: true });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Skill 删除失败" },
      { status: 400 },
    );
  }
}
