"use client";

import Link from "next/link";
import { ArrowLeft, Plus } from "lucide-react";
import { ProjectList } from "@/components/project-list";
import { PreferenceControls } from "@/components/theme-toggle";
import {
  AppHeader,
  PageContainer,
  PageShell,
} from "@/components/app-chrome";
import { usePreferences } from "@/lib/preferences";

export default function ProjectsPage() {
  const { t } = usePreferences();

  return (
    <PageShell>
      <AppHeader actions={<PreferenceControls />} />

      <section className="flex-1 py-10 md:py-14">
        <PageContainer>
          <header className="mb-12 flex flex-wrap items-end justify-between gap-8">
            <div className="flex max-w-2xl flex-col gap-3">
              <Link
                href="/"
                className="app-btn-ghost inline-flex w-fit items-center gap-1.5 text-xs font-medium"
              >
                <ArrowLeft className="size-3.5" />
                {t("nav.backHome")}
              </Link>
              <h1 className="app-heading-page">{t("projects.title")}</h1>
              <p className="text-sm leading-relaxed app-subtle">
                {t("projects.description")}
              </p>
            </div>
            <Link
              href="/"
              className="app-btn app-primary shrink-0 rounded-xl px-5"
            >
              <Plus className="size-4" />
              {t("projects.create")}
            </Link>
          </header>

          <ProjectList />
        </PageContainer>
      </section>
    </PageShell>
  );
}
