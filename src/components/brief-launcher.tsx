"use client";

/**
 * 首页 Brief 入口：校验配置后立即进入 IDE，在画布页跑生成流水线
 * --------------------------------------------------------------
 * @author：wangjunhua
 */

import { ArrowUp, Cpu, Loader2, Sparkles } from "lucide-react";
import { nanoid } from "nanoid";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { SkillPicker } from "@/components/skills/skill-picker";
import { cn } from "@/lib/cn";
import { usePreferences } from "@/lib/preferences";
import { createPlaceholderProject } from "@/lib/project/placeholder";
import { getImageChipLabel, getLlmChipLabel } from "@/lib/providers/provider-label";
import { isMockImageConfig, isMockLlmConfig } from "@/lib/providers/validate";
import { openSettings } from "@/lib/settings/events";
import { resolveHomeSkillChoice } from "@/lib/skills/selection";
import { useSkillCatalog } from "@/lib/skills/use-skill-catalog";
import { getTargetRecipe, HOME_TARGET_IDS, type TargetId } from "@/lib/targets/catalog";
import { useHydrated, useProviderStoreHydrated } from "@/lib/use-hydrated";
import { useHomeGenerateStore } from "@/store/home-generate-store";
import { useProjectStore } from "@/store/project-store";
import { useProviderStore } from "@/store/provider-store";

export function BriefLauncher({ className }: { className?: string }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const providerHydrated = useProviderStoreHydrated();
  const upsert = useProjectStore((s) => s.upsert);
  const setGenerateJob = useHomeGenerateStore((s) => s.setJob);
  const providerConfig = useProviderStore((s) => s.config);
  const { t } = usePreferences();
  const [idea, setIdea] = useState("");
  const [navigating, setNavigating] = useState(false);
  const [targetId, setTargetId] = useState<TargetId>("ui-visual");
  const [targetLocked, setTargetLocked] = useState(false);
  const [skillId, setSkillId] = useState<string | null>(null);
  const recipe = getTargetRecipe(targetId);
  const { skills, loading: skillsLoading } = useSkillCatalog();
  const selectedSkill = skills.find((skill) => skill.name === skillId);

  useEffect(() => {
    setSkillId((current) =>
      resolveHomeSkillChoice({
        current,
        skills,
        targetId,
      }),
    );
  }, [skills, targetId]);

  const chipReady = hydrated && providerHydrated;
  const llmLabel = chipReady
    ? getLlmChipLabel(providerConfig, t("brief.mock"), t("brief.realModel"))
    : t("projects.loading");
  const imageLabel = chipReady ? getImageChipLabel(providerConfig, "生图 Mock") : "";

  function submit() {
    if (!idea.trim() || navigating) return;
    if (!providerHydrated) return;

    if (isMockLlmConfig(providerConfig)) {
      openSettings("models");
      return;
    }
    if (isMockImageConfig(providerConfig)) {
      openSettings("models");
      return;
    }

    const trimmed = idea.trim();
    const projectId = nanoid(10);
    const runConfig = {
      ...providerConfig,
      skillId: selectedSkill?.name,
      designSystemId: selectedSkill?.recommendedDesignSystem ?? providerConfig.designSystemId,
    };
    const stub = createPlaceholderProject(projectId, trimmed, {
      targetId,
      targetLocked,
      skillId: selectedSkill?.name,
      skillVersion: selectedSkill?.version,
      designSystemId: runConfig.designSystemId,
    });

    upsert(stub);
    setGenerateJob({
      projectId,
      idea: trimmed,
      providerConfig: runConfig,
      targetId,
    });

    setNavigating(true);
    router.push(`/projects/${projectId}`);
  }

  const mockError =
    chipReady && isMockLlmConfig(providerConfig)
      ? "还没配置大模型。打开设置填写 API Key 后即可生成。"
      : chipReady && isMockImageConfig(providerConfig)
        ? "还没配置生图模型。打开设置保存后即可生成。"
        : null;

  const canSubmit = Boolean(idea.trim()) && chipReady && !navigating;

  return (
    <div className={cn("w-full max-w-[40rem]", className)}>
      <div className="vad-home-targets" role="tablist" aria-label="视觉目标">
        {HOME_TARGET_IDS.map((id) => {
          const item = getTargetRecipe(id);
          const active = id === targetId;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={active}
              disabled={navigating}
              onClick={() => {
                setTargetId(id);
                setTargetLocked(true);
              }}
              className={`vad-home-target${active ? " is-active" : ""}`}
            >
              {item.label}
            </button>
          );
        })}
        <button
          type="button"
          disabled
          className="vad-home-target vad-home-target-more"
          title="即将支持：图标贴纸、分镜动态"
        >
          更多
        </button>
      </div>

      <div className="vad-home-composer">
        <SkillPicker
          variant="composer"
          skills={skills}
          value={skillId ?? undefined}
          targetId={targetId}
          disabled={skillsLoading || navigating}
          onChange={(skill) => setSkillId(skill ? skill.name : null)}
        />
        <textarea
          id="studio-prompt-input"
          value={idea}
          onChange={(e) => setIdea(e.target.value)}
          placeholder={recipe.placeholder}
          rows={3}
          className="vad-home-composer-input"
          disabled={navigating}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit();
          }}
        />

        <div className="flex flex-wrap items-center justify-between gap-3 px-3.5 pb-3 pt-1">
          <button
            type="button"
            onClick={() => openSettings("models")}
            className="vad-home-model-chip max-w-full"
            title={t("brief.providerTitle")}
          >
            <Cpu className="size-3.5 shrink-0 text-[var(--primary)]" />
            <span className="truncate">
              {chipReady ? (
                <>
                  {llmLabel}
                  {imageLabel ? <span className="opacity-55"> · {imageLabel}</span> : null}
                </>
              ) : (
                t("projects.loading")
              )}
            </span>
          </button>

          <button type="button" onClick={submit} disabled={!canSubmit} className="vad-home-submit">
            {navigating ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <ArrowUp className="size-3.5" strokeWidth={2.5} />
            )}
            <span>{navigating ? "进入工作台…" : t("brief.submit")}</span>
            {!navigating ? <Sparkles className="size-3.5 opacity-80" /> : null}
          </button>
        </div>
      </div>

      <div className="mt-4 flex flex-col items-center gap-2.5">
        <p className="text-[11px] tracking-[-0.01em] text-[var(--muted)]">
          {t("home.examplesTitle")}
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          {recipe.examples.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => setIdea(example)}
              disabled={navigating}
              className="vad-home-example"
            >
              <span className="truncate">{example}</span>
            </button>
          ))}
        </div>
        <p className="text-[10.5px] tracking-[-0.01em] text-[var(--muted)]/75">
          {navigating ? "正在打开画布工作台，生成进度将在右侧助理栏流式展示…" : t("brief.shortcut")}
        </p>
      </div>

      {mockError ? (
        <button type="button" className="studio-setup-hint" onClick={() => openSettings("models")}>
          {mockError}
        </button>
      ) : null}
    </div>
  );
}
