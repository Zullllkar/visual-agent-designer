"use client";

import { Languages, Moon, Sun } from "lucide-react";
import { usePreferences } from "@/lib/preferences";
import { cn } from "@/lib/cn";

export function ThemeToggle() {
  const { theme, toggleTheme, t } = usePreferences();
  const isDark = theme === "dark";

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className="app-chip"
      aria-label={isDark ? t("theme.toLight") : t("theme.toDark")}
      title={isDark ? t("theme.toLight") : t("theme.toDark")}
    >
      {isDark ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
      <span>{isDark ? t("theme.light") : t("theme.dark")}</span>
    </button>
  );
}

export function LocaleToggle() {
  const { locale, setLocale, t } = usePreferences();
  const nextLocale = locale === "zh" ? "en" : "zh";

  return (
    <button
      type="button"
      onClick={() => setLocale(nextLocale)}
      className="app-chip"
      aria-label={nextLocale === "zh" ? t("locale.zh") : t("locale.en")}
      title={nextLocale === "zh" ? t("locale.zh") : t("locale.en")}
    >
      <Languages className="size-3.5" />
      <span>{locale === "zh" ? "EN" : "中"}</span>
    </button>
  );
}

export function PreferenceControls({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <LocaleToggle />
      <ThemeToggle />
    </div>
  );
}
