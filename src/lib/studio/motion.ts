"use client";

import { useEffect, useState } from "react";

export const STUDIO_MOTION_KEY = "vad.studio.reduceMotion";
const MOTION_EVENT = "vad-studio-motion";

export function readReduceMotion(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STUDIO_MOTION_KEY) === "1";
  } catch {
    return false;
  }
}

export function applyReduceMotion(on: boolean) {
  document.documentElement.classList.toggle("reduce-motion", on);
}

export function writeReduceMotion(on: boolean) {
  try {
    window.localStorage.setItem(STUDIO_MOTION_KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
  applyReduceMotion(on);
  window.dispatchEvent(new Event(MOTION_EVENT));
}

export function useReduceMotion() {
  const [on, setOn] = useState(false);

  useEffect(() => {
    const current = readReduceMotion();
    setOn(current);
    applyReduceMotion(current);
    const sync = () => setOn(readReduceMotion());
    window.addEventListener(MOTION_EVENT, sync);
    return () => window.removeEventListener(MOTION_EVENT, sync);
  }, []);

  function persist(next: boolean) {
    writeReduceMotion(next);
    setOn(next);
  }

  return [on, persist] as const;
}
