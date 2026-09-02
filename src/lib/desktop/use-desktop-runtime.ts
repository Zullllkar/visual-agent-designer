"use client";

import { useLayoutEffect, useState } from "react";

export function isDesktopBridge(): boolean {
  return typeof window !== "undefined" && window.vadDesktop?.runtime === "electron";
}

export function useDesktopRuntime(): boolean {
  const [desktop, setDesktop] = useState(false);

  useLayoutEffect(() => {
    if (!isDesktopBridge()) return;
    document.documentElement.classList.add("vad-desktop");
    if (window.vadDesktop && navigator.platform.toLowerCase().includes("mac")) {
      document.documentElement.classList.add("vad-desktop-mac");
    }
    setDesktop(true);
  }, []);

  return desktop;
}
