"use client";

/**
 * 首页 Brief 入口：校验配置后立即进入 IDE，在画布页跑生成流水线
 * --------------------------------------------------------------
 * @author：wangjunhua
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { nanoid } from "nanoid";
import { Sparkles, Loader2, Cpu, ArrowUp } from "lucide-react";
import { useProjectStore } from "@/store/project-store";
import { useProviderStore } from "@/store/provider-store";
import { makeUserMessage, useChatStore } from "@/store/chat-store";
import { useHomeGenerateStore } from "@/store/home-generate-store";
import { useHydrated, useProviderStoreHydrated } from "@/lib/use-hydrated";
import { usePreferences } from "@/lib/preferences";
import { ProviderSettingsDialog } from "@/components/provider-settings-dialog";
import { createPlaceholderProject } from "@/lib/project/placeholder";
import {
  getImageChipLabel,
  getLlmChipLabel,
} from "@/lib/providers/provider-label";
import {
  isMockImageConfig,
  isMockLlmConfig,
} from "@/lib/providers/validate";

export function BriefLauncher() {
  const router = useRouter();
  const hydrated = useHydrated();
  const providerHydrated = useProviderStoreHydrated();
  const upsert = useProjectStore((s) => s.upsert);
  const setGenerateJob = useHomeGenerateStore((s) => s.setJob);
  const providerConfig = useProviderStore((s) => s.config);
  const chatAppend = useChatStore((s) => s.append);
  const { t } = usePreferences();
  const [idea, setIdea] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [navigating, setNavigating] = useState(false);

  const chipReady = hydrated && providerHydrated;
  const llmLabel = chipReady
    ? getLlmChipLabel(providerConfig, t("brief.mock"), t("brief.realModel"))
    : t("projects.loading");
  const imageLabel = chipReady
    ? getImageChipLabel(providerConfig, "生图 Mock")
    : "";

  function submit() {
    if (!idea.trim() || navigating) return;
    if (!providerHydrated) return;

    if (isMockLlmConfig(providerConfig)) {
      setSettingsOpen(true);
      return;
    }
    if (isMockImageConfig(providerConfig)) {
      setSettingsOpen(true);
      return;
    }

    const trimmed = idea.trim();
    const projectId = nanoid(10);
    const stub = createPlaceholderProject(projectId, trimmed);

    upsert(stub);
    chatAppend(projectId, makeUserMessage(trimmed));
    setGenerateJob({
      projectId,
      idea: trimmed,
      providerConfig,
    });

    setNavigating(true);
    router.push(`/projects/${projectId}`);
  }

  const mockError =
    chipReady && isMockLlmConfig(providerConfig)
      ? "请打开模型设置，选择「智能大模型」并填写 API Key / 模型后点击「保存配置」。"
      : chipReady && isMockImageConfig(providerConfig)
        ? "请同时在设置里配置生图模型（OpenAI / Gemini / SiliconFlow 等）并保存。"
        : null;

  const canSubmit = Boolean(idea.trim()) && chipReady && !navigating;

  return (
    <div className="w-full max-w-[40rem]">
      <div className="vad-home-composer">
        <textarea
          value={idea}
          onChange={(e) => setIdea(e.target.value)}
          placeholder={t("brief.placeholder")}
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
            onClick={() => setSettingsOpen(true)}
            className="vad-home-model-chip max-w-full"
            title={t("brief.providerTitle")}
          >
            <Cpu className="size-3.5 shrink-0 text-[var(--primary)]" />
            <span className="truncate">
              {chipReady ? (
                <>
                  {llmLabel}
                  {imageLabel ? (
                    <span className="opacity-55"> · {imageLabel}</span>
                  ) : null}
                </>
              ) : (
                t("projects.loading")
              )}
            </span>
          </button>

          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className="vad-home-submit"
          >
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
          {[
            t("home.example.fitness"),
            t("home.example.saas"),
            t("home.example.shop"),
          ].map((example) => (
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
          {navigating
            ? "正在打开画布工作台，生成进度将在右侧助理栏流式展示…"
            : t("brief.shortcut")}
        </p>
      </div>

      {mockError ? (
        <p className="mt-4 rounded-xl border border-red-200/80 bg-red-50/90 px-4 py-3 text-left text-xs leading-relaxed text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
          {mockError}
        </p>
      ) : null}

      {settingsOpen ? (
        <ProviderSettingsDialog onClose={() => setSettingsOpen(false)} />
      ) : null}
    </div>
  );
}
