import {
  getAllSkillRegistry,
  getDesignSystemRegistry,
  invalidateRegistry,
} from "@/lib/skills/registry";
import { parseSkillDocument, writeUserSkillDocument } from "@/lib/skills/storage";

/**
 * GET /api/skills
 * 返回所有可用 Skill 和 DesignSystem 的 manifest 列表，
 * 给 UI 的 Skill Picker / Design System Picker 用。
 *
 * 不返回 markdown body（太大），只返回 frontmatter 元数据。
 */
export async function GET() {
  const [skills, designSystems] = await Promise.all([
    getAllSkillRegistry(),
    getDesignSystemRegistry(),
  ]);
  return Response.json({
    skills: skills.map((s) => ({
      ...s.manifest,
      sourcePath: s.sourcePath,
      bodyPreview: s.body.slice(0, 300),
      origin: s.origin,
      enabled: s.enabled,
    })),
    designSystems: designSystems.map((d) => ({
      ...d.manifest,
      sourcePath: d.sourcePath,
      bodyPreview: d.body.slice(0, 300),
    })),
  });
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as {
      action?: "create" | "validate";
      raw?: string;
    };
    if (typeof payload.raw !== "string") {
      return Response.json({ error: "缺少 SKILL.md 内容" }, { status: 400 });
    }
    const parsed = parseSkillDocument(payload.raw);
    if (payload.action === "validate") {
      return Response.json({ valid: true, manifest: parsed.manifest });
    }

    const all = await getAllSkillRegistry();
    if (all.some((skill) => skill.manifest.name === parsed.manifest.name)) {
      return Response.json({ error: `Skill "${parsed.manifest.name}" 已存在` }, { status: 409 });
    }
    await writeUserSkillDocument(parsed.raw);
    invalidateRegistry();
    return Response.json(
      {
        skill: {
          ...parsed.manifest,
          sourcePath: `user-skills/${parsed.manifest.name}/SKILL.md`,
          bodyPreview: parsed.body.slice(0, 300),
          body: parsed.body,
          raw: parsed.raw,
          origin: "user",
          enabled: true,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Skill 保存失败" },
      { status: 400 },
    );
  }
}
