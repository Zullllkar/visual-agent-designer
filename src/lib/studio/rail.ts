"use client";

import { useEffect, useState } from "react";

export const STUDIO_RAIL_KEY = "vad.studio.rail";
const RAIL_EVENT = "vad-studio-rail";

export function readStudioRail(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STUDIO_RAIL_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeStudioRail(next: boolean) {
  try {
    window.localStorage.setItem(STUDIO_RAIL_KEY, next ? "1" : "0");
  } catch {
    /* ignore quota */
  }
  window.dispatchEvent(new Event(RAIL_EVENT));
}

export function useStudioRail() {
  const [rail, setRail] = useState(false);

  useEffect(() => {
    setRail(readStudioRail());
    const sync = () => setRail(readStudioRail());
    window.addEventListener(RAIL_EVENT, sync);
    return () => window.removeEventListener(RAIL_EVENT, sync);
  }, []);

  function persist(next: boolean) {
    writeStudioRail(next);
    setRail(next);
  }

  return [rail, persist] as const;
}
