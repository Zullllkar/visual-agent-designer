import "server-only";

import type { ProjectFile } from "@/lib/project/schema";
import type { ProviderConfig } from "@/lib/providers/registry";
import { resolveDesignSystem, resolveSkill } from "./registry";

export async function resolveSkillContext(
  providerConfig?: ProviderConfig,
  project?: Pick<ProjectFile, "skillId" | "designSystemId"> | null,
) {
  const skillId = project?.skillId ?? providerConfig?.skillId;
  const skill = await resolveSkill(skillId);
  const designSystemId =
    project?.designSystemId ??
    providerConfig?.designSystemId ??
    skill?.manifest.recommendedDesignSystem;
  const designSystem = await resolveDesignSystem(designSystemId);

  return {
    skill,
    designSystem,
    requestedSkillId: skillId,
    skillMissing: Boolean(skillId && !skill),
  };
}
