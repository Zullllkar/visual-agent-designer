"use client";

/**
 * 首页：开源工具站质感 Launchpad
 * --------------------------------------------------------------
 * 大气氛围 + 品牌标题 + 精致输入 + 安静信任信号 + 最近项目
 * @author：wangjunhua
 */

import { useMemo } from "react";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, Clock3, Sparkles } from "lucide-react";
import { BriefLauncher } from "@/components/brief-launcher";
import {
  AppFooter,
  AppHeader,
  PageContainer,
  PageShell,
} from "@/components/app-chrome";
import { usePreferences } from "@/lib/preferences";
import { useProjectStore } from "@/store/project-store";
import { useProjectStoreHydrated } from "@/lib/use-hydrated";

export default function Home() {
  const { t } = usePreferences();

  const flowSteps = [
    {
      key: "brief",
      label: t("home.flow.brief.label"),
      detail: t("home.flow.brief.detail"),
    },
    {
      key: "canvas",
      label: t("home.flow.canvas.label"),
      detail: t("home.flow.canvas.detail"),
    },
    {
      key: "handoff",
      label: t("home.flow.handoff.label"),
      detail: t("home.flow.handoff.detail"),
    },
  ] as const;

  const trustItems = [
    t("home.trust.local"),
    t("home.trust.providers"),
    t("home.trust.keys"),
    t("home.trust.open"),
  ];

  return (
    <PageShell className="vad-home">
      <AppHeader />

      <section className="vad-home-hero relative flex flex-1 flex-col items-center justify-center overflow-hidden px-4 pb-16 pt-14 md:pb-24 md:pt-20">
        <div className="vad-home-atmosphere" aria-hidden />
        <div className="vad-home-grid" aria-hidden />

        <PageContainer className="relative z-[1] flex flex-col items-center gap-8 text-center">
          <div className="vad-home-brand-mark">
            <Sparkles className="size-3.5" aria-hidden />
            <span>{t("app.name")}</span>
            <span className="vad-home-brand-sep" aria-hidden />
            <span className="opacity-70">{t("app.badge")}</span>
          </div>

          <div className="flex max-w-[22rem] flex-col items-center gap-4 sm:max-w-[34rem] md:max-w-[42rem]">
            <h1 className="vad-home-title text-balance">
              {t("home.titleLine1")}
              <br />
              <span className="vad-home-title-accent">{t("home.titleLine2")}</span>
            </h1>
            <p className="max-w-[48ch] text-[15px] leading-[1.7] tracking-[-0.01em] text-[var(--muted)]">
              {t("home.description")}
            </p>
          </div>

          <BriefLauncher />

          <ul className="flex flex-wrap items-center justify-center gap-2">
            {trustItems.map((item) => (
              <li key={item} className="vad-home-trust-pill">
                {item}
              </li>
            ))}
          </ul>

          <ol className="vad-home-flow flex flex-wrap items-center justify-center gap-x-1.5 gap-y-2">
            {flowSteps.map((step, index) => (
              <li
                key={step.key}
                className="flex items-center gap-1.5"
                title={step.detail}
              >
                <span className="vad-home-flow-step">
                  <span className="vad-home-flow-index">{index + 1}</span>
                  {step.label}
                </span>
                {index < flowSteps.length - 1 ? (
                  <ArrowRight
                    className="size-3.5 text-[var(--muted)]/70"
                    aria-hidden
                  />
                ) : null}
              </li>
            ))}
          </ol>
        </PageContainer>
      </section>

      <RecentProjects />

      <AppFooter />
    </PageShell>
  );
}

function RecentProjects() {
  const hydrated = useProjectStoreHydrated();
  const projectsDict = useProjectStore((s) => s.projects);
  const { t, locale } = usePreferences();

  const recent = useMemo(
    () =>
      Object.values(projectsDict)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, 3),
    [projectsDict]
  );

  if (!hydrated || recent.length === 0) return null;

  return (
    <section className="vad-home-recent relative border-t border-[color-mix(in_srgb,var(--border)_75%,transparent)] py-12 md:py-14">
      <PageContainer>
        <div className="mb-6 flex items-end justify-between gap-4">
          <div>
            <h2 className="flex items-center gap-2 text-[13px] font-semibold tracking-[-0.02em] text-[var(--foreground)]">
              <Clock3 className="size-3.5 text-[var(--primary)]" aria-hidden />
              {t("home.recent")}
            </h2>
            <p className="mt-1 text-[12px] text-[var(--muted)]">
              {t("home.footer")}
            </p>
          </div>
          <Link href="/projects" className="vad-home-link">
            {t("home.viewAll")}
            <ArrowUpRight className="size-3.5" aria-hidden />
          </Link>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          {recent.map((p, i) => (
            <Link
              key={p.id}
              href={`/projects/${p.id}`}
              className="vad-home-project group"
              style={{ animationDelay: `${i * 40}ms` }}
            >
              <div className="vad-home-project-preview" aria-hidden>
                <span className="vad-home-project-dot" />
                <span className="vad-home-project-bar" />
              </div>
              <div className="flex items-start justify-between gap-3">
                <h3 className="line-clamp-1 text-[13px] font-semibold tracking-[-0.02em] transition-colors group-hover:text-[var(--primary)]">
                  {p.title}
                </h3>
                <span className="shrink-0 rounded-md bg-[var(--surface-muted)] px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-[var(--muted)]">
                  {p.pages.length} {t("projects.pages")}
                </span>
              </div>
              <p className="mt-2 line-clamp-2 text-[12px] leading-relaxed text-[var(--muted)]">
                {p.rawIdea}
              </p>
              <p className="mt-3 text-[11px] tabular-nums text-[var(--muted)]/80">
                {t("projects.updated")}{" "}
                {new Date(p.updatedAt).toLocaleDateString(
                  locale === "zh" ? "zh-CN" : "en-US"
                )}
              </p>
            </Link>
          ))}
        </div>
      </PageContainer>
    </section>
  );
}
