"use client";

/**
 * 首页 Brief 入口：校验配置后立即进入 IDE，在画布页跑生成流水线
 * --------------------------------------------------------------
 * @author：wangjunhua
 */

import {
  ArrowUp,
  Check,
  ChevronDown,
  LayoutTemplate,
  Loader2,
  type LucideIcon,
  Megaphone,
  Package,
  Palette,
  Smartphone,
  Swords,
} from "lucide-react";
import { nanoid } from "nanoid";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ComposerModelChip } from "@/components/brand/composer-model-marks";
import { SkillPicker } from "@/components/skills/skill-picker";
import { WorkspacePicker } from "@/components/studio/workspace-picker";
import { cn } from "@/lib/cn";
import { resolveBoundProjectId } from "@/lib/studio/bound-project-id";
import { usePreferences } from "@/lib/preferences";
import { createPlaceholderProject } from "@/lib/project/placeholder";
import { isMockImageConfig, isMockLlmConfig } from "@/lib/providers/validate";
import { openSettings } from "@/lib/settings/events";
import { resolveHomeSkillChoice } from "@/lib/skills/selection";
import { useSkillCatalog } from "@/lib/skills/use-skill-catalog";
import { getTargetRecipe, HOME_TARGET_IDS, type TargetId } from "@/lib/targets/catalog";
import { useHydrated, useProviderStoreHydrated } from "@/lib/use-hydrated";
import {
  type HomeWorkspace,
  pickAndAttachWorkspace,
  readStoredHomeWorkspace,
} from "@/lib/studio/workspace-client";
import { useHomeGenerateStore } from "@/store/home-generate-store";
import { useProjectStore } from "@/store/project-store";
import { useProviderStore } from "@/store/provider-store";

const TARGET_ICONS: Record<TargetId, LucideIcon> = {
  "ui-visual": LayoutTemplate,
  "game-art": Swords,
  "promo-kv": Megaphone,
  "social-cover": Smartphone,
  "product-shot": Package,
  "style-board": Palette,
};

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
  const [workspace, setWorkspace] = useState<HomeWorkspace | null>(null);
  const [targetOpen, setTargetOpen] = useState(false);
  const targetRef = useRef<HTMLDivElement>(null);
  const recipe = getTargetRecipe(targetId);
  const { skills, loading: skillsLoading } = useSkillCatalog();
  const selectedSkill = skills.find((skill) => skill.name === skillId);

  useEffect(() => {
    setWorkspace(readStoredHomeWorkspace());
  }, []);

  useEffect(() => {
    if (!targetOpen) return;
    function close(event: PointerEvent) {
      if (!targetRef.current?.contains(event.target as Node)) setTargetOpen(false);
    }
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [targetOpen]);

  useEffect(() => {
    setSkillId(
      (current) =>
        resolveHomeSkillChoice({
          current,
          skills,
          targetId,
        }) ?? null,
    );
  }, [skills, targetId]);

  const chipReady = hydrated && providerHydrated;

  async function submit() {
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
    let bound = workspace;
    if (!bound?.path && !bound?.projectId) {
      try {
        bound = await pickAndAttachWorkspace({
          mkdirIfMissing: true,
          idea: trimmed,
        });
      } catch {
        return;
      }
      if (!bound) return;
      setWorkspace(bound);
    }

    const existing =
      bound.projectId ? useProjectStore.getState().get(bound.projectId) : undefined;
    const projectId =
      resolveBoundProjectId({
        existingId: existing?.id,
        boundProjectId: bound.projectId,
      }) ?? nanoid(10);
    const runConfig = {
      ...providerConfig,
      skillId: selectedSkill?.name,
      designSystemId: selectedSkill?.recommendedDesignSystem ?? providerConfig.designSystemId,
    };
    const stub = existing
      ? {
          ...existing,
          rawIdea: trimmed,
          title:
            trimmed.slice(0, 48) + (trimmed.length > 48 ? "…" : "") || existing.title,
          updatedAt: new Date().toISOString(),
          workspacePath: bound.path || existing.workspacePath,
          targetId,
          targetLocked,
          skillId: selectedSkill?.name,
          skillVersion: selectedSkill?.version,
          designSystemId: runConfig.designSystemId,
        }
      : createPlaceholderProject(projectId, trimmed, {
          targetId,
          targetLocked,
          skillId: selectedSkill?.name,
          skillVersion: selectedSkill?.version,
          designSystemId: runConfig.designSystemId,
          workspacePath: bound.path || undefined,
        });

    upsert(stub);
    setGenerateJob({
      projectId: stub.id,
      idea: trimmed,
      providerConfig: runConfig,
      targetId,
    });

    setNavigating(true);
    router.push(`/projects/${stub.id}`);
  }

  const mockError =
    chipReady && isMockLlmConfig(providerConfig)
      ? "还没配置大模型。打开设置填写 API Key 后即可生成。"
      : chipReady && isMockImageConfig(providerConfig)
        ? "还没配置生图模型。打开设置保存后即可生成。"
        : null;

  const canSubmit = Boolean(idea.trim()) && chipReady && !navigating;
  const modelMissing = Boolean(mockError);

  const TargetIcon = TARGET_ICONS[targetId];

  return (
    <div className={cn("studio-launch", className)}>
      <div className="studio-composer-stack">
      <div className={`studio-composer${navigating ? " is-busy" : ""}`}>
        <textarea
          id="studio-prompt-input"
          value={idea}
          onChange={(e) => setIdea(e.target.value)}
          placeholder={recipe.placeholder}
          rows={3}
          className="studio-composer-input"
          disabled={navigating}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void submit();
          }}
        />

        <div className="studio-composer-bar">
          <div className="studio-composer-tools">
            <div className="studio-target-menu" ref={targetRef}>
              <button
                type="button"
                className={`studio-tool-chip studio-target-chip${targetOpen ? " is-open" : ""}`}
                aria-haspopup="listbox"
                aria-expanded={targetOpen}
                aria-label={`视觉目标：${recipe.label}`}
                disabled={navigating}
                onClick={() => setTargetOpen((open) => !open)}
              >
                <TargetIcon className="size-3.5" strokeWidth={1.75} aria-hidden />
                <span>{recipe.label}</span>
                <ChevronDown className="size-3" aria-hidden />
              </button>
              {targetOpen ? (
                <div className="studio-target-popover" role="listbox" aria-label="视觉目标">
                  {HOME_TARGET_IDS.map((id) => {
                    const item = getTargetRecipe(id);
                    const Icon = TARGET_ICONS[id];
                    const active = id === targetId;
                    return (
                      <button
                        key={id}
                        type="button"
                        role="option"
                        aria-selected={active}
                        className={`studio-target-option${active ? " is-active" : ""}`}
                        onClick={() => {
                          setTargetId(id);
                          setTargetLocked(true);
                          setTargetOpen(false);
                        }}
                      >
                        <Icon className="size-3.5" strokeWidth={1.75} aria-hidden />
                        <span>{item.label}</span>
                        {active ? <Check className="size-3.5" aria-hidden /> : null}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
            <SkillPicker
              variant="chip"
              skills={skills}
              value={skillId ?? undefined}
              targetId={targetId}
              disabled={skillsLoading || navigating}
              onChange={(skill) => setSkillId(skill ? skill.name : null)}
            />
            <ComposerModelChip
              config={providerConfig}
              disabled={navigating}
              className={`studio-tool-chip studio-model-chip${modelMissing ? " is-warn" : ""}`}
              onOpenSettings={() => openSettings("models")}
            />
          </div>

          <button
            type="button"
            onClick={() => void submit()}
            disabled={!canSubmit}
            className="studio-composer-submit"
            aria-label={navigating ? "进入工作台…" : t("brief.submit")}
            title={`${t("brief.submit")} · ${t("brief.shortcut")}`}
          >
            {navigating ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <ArrowUp className="size-4" strokeWidth={2.4} />
            )}
          </button>
        </div>
      </div>

      <WorkspacePicker
        value={workspace}
        onChange={setWorkspace}
        disabled={navigating}
        idea={idea}
      />
      </div>

      {navigating ? (
        <p className="studio-launch-status" role="status">
          正在打开画布工作台，生成进度会在右侧助理栏流式展示
        </p>
      ) : mockError ? (
        <button type="button" className="studio-setup-hint" onClick={() => openSettings("models")}>
          <span className="studio-setup-hint-dot" aria-hidden />
          <span>{mockError}</span>
          <strong>打开设置</strong>
        </button>
      ) : null}
    </div>
  );
}
