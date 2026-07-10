"use client";

import Link from "next/link";
import { usePreferences } from "@/lib/preferences";
import { PreferenceControls } from "@/components/theme-toggle";
import { cn } from "@/lib/cn";

/**
 * 全站共享布局 chrome：顶栏 / 页脚 / 品牌标识
 * @author：wangjunhua
 */

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden
      className={className}
    >
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

export function AppLogo({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "app-logo grid size-8 shrink-0 place-items-center rounded-[10px]",
        className
      )}
    >
      <span aria-hidden className="font-serif text-[13px] italic leading-none">◇</span>
    </div>
  );
}

export function AppHeader() {
  return (
    <header className="app-header">
      <div className="app-container flex h-14 items-center justify-between gap-4">
        <Link href="/" className="flex min-w-0 items-center gap-2.5 transition-opacity hover:opacity-90">
          <AppLogo />
          <span className="block truncate text-[13px] font-semibold tracking-[-0.02em] sm:text-sm">Visual Agent Designer</span>
        </Link>
        <nav className="app-header-actions" aria-label="全局操作">
          <PreferenceControls />
          <a
            href="https://github.com/Zullllkar/visual-agent-designer"
            target="_blank"
            rel="noreferrer"
            className="app-header-action"
          >
            <GitHubIcon className="size-3.5" />
            <span>GitHub</span>
          </a>
          <Link href="/projects" className="app-header-action app-header-action-primary">
            <span>Canvas</span>
          </Link>
        </nav>
      </div>
    </header>
  );
}

export function AppFooter() {
  const { t } = usePreferences();

  return (
    <footer className="app-footer mt-auto">
      <div className="app-container flex flex-wrap items-center justify-between gap-3 py-7 text-[11px] tracking-[-0.01em] text-[var(--muted)]">
        <span>
          {t("app.name")} · {t("home.footer")}
        </span>
        <span className="opacity-80">{t("home.powered")}</span>
      </div>
    </footer>
  );
}

export function PageShell({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <main className={cn("app-page flex min-h-screen flex-col", className)}>
      {children}
    </main>
  );
}

export function PageContainer({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cn("app-container", className)}>{children}</div>;
}
