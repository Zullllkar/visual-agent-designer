import type { ProductBrief, ProjectFile } from "./schema";

export function briefFromProject(
  project: Pick<
    ProjectFile,
    "title" | "rawIdea" | "brief" | "designDirection" | "targetId"
  >,
  seed?: { prompt?: string; userMessage?: string }
): ProductBrief {
  if (project.brief) return project.brief;
  const name = project.title.trim() || "Untitled";
  const idea =
    project.rawIdea.trim() ||
    seed?.prompt?.trim() ||
    seed?.userMessage?.trim() ||
    name;
  return {
    productName: name,
    positioning: idea.slice(0, 500),
    targetUser: "",
    scenarios: [],
    coreFeatures: [],
    platform: project.targetId === "ui-visual" ? "app" : "other",
    visualStyle: project.designDirection?.summary?.trim() || "",
    outputTargets: ["markdown"],
  };
}

/** 画布项目可以没有跑过 generate_brief；生图不能因此直接失败。 */
export function ensureProjectBrief(
  project: ProjectFile,
  seed?: { prompt?: string; userMessage?: string }
): ProjectFile {
  if (project.brief) return project;
  return { ...project, brief: briefFromProject(project, seed) };
}
