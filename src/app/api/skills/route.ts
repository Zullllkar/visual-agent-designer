import {
  getSkillRegistry,
  getDesignSystemRegistry,
} from "@/lib/skills/registry";

/**
 * GET /api/skills
 * 返回所有可用 Skill 和 DesignSystem 的 manifest 列表，
 * 给 UI 的 Skill Picker / Design System Picker 用。
 *
 * 不返回 markdown body（太大），只返回 frontmatter 元数据。
 */
export async function GET() {
  const [skills, designSystems] = await Promise.all([
    getSkillRegistry(),
    getDesignSystemRegistry(),
  ]);
  return Response.json({
    skills: skills.map((s) => ({
      ...s.manifest,
      sourcePath: s.sourcePath,
      bodyPreview: s.body.slice(0, 300),
    })),
    designSystems: designSystems.map((d) => ({
      ...d.manifest,
      sourcePath: d.sourcePath,
      bodyPreview: d.body.slice(0, 300),
    })),
  });
}
