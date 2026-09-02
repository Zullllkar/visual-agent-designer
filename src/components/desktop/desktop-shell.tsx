"use client";

import { useEffect } from "react";
import { useDesktopRuntime } from "@/lib/desktop/use-desktop-runtime";
import { usePreferences } from "@/lib/preferences";
import { DesktopStatusbar } from "./desktop-statusbar";
import { DesktopTitlebar } from "./desktop-titlebar";

export function DesktopShell({ children }: { children: React.ReactNode }) {
  const desktop = useDesktopRuntime();
  const { resolvedTheme } = usePreferences();

  useEffect(() => {
    if (!desktop) return;
    window.vadDesktop?.setTitleBarTheme(resolvedTheme);
  }, [desktop, resolvedTheme]);

  if (!desktop) return children;

  return (
    <>
      <DesktopTitlebar />
      <div className="desktop-scroll">{children}</div>
      <DesktopStatusbar />
    </>
  );
}
