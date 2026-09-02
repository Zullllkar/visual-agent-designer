import { isSafeProjectId } from "@/lib/studio/project-actions";

export const STARTUP_PREF_KEY = "vad.studio.startup";
export const LAST_PROJECT_KEY = "vad.studio.lastProjectId";
export const STARTUP_SESSION_KEY = "vad.studio.startupApplied";

export type StartupPreference = "home" | "last";

export function decideStartupTarget(input: {
  preference: StartupPreference;
  lastProjectId: string | null;
  alreadyApplied: boolean;
  currentPath: string;
}): string | null {
  if (input.alreadyApplied) return null;
  if (input.preference !== "last") return null;
  if (input.currentPath !== "/") return null;
  if (!input.lastProjectId || !isSafeProjectId(input.lastProjectId)) return null;
  return `/projects/${input.lastProjectId}`;
}

export function readStartupPreference(): StartupPreference {
  if (typeof window === "undefined") return "home";
  try {
    return window.localStorage.getItem(STARTUP_PREF_KEY) === "last" ? "last" : "home";
  } catch {
    return "home";
  }
}

export function writeStartupPreference(next: StartupPreference) {
  try {
    window.localStorage.setItem(STARTUP_PREF_KEY, next);
  } catch {
    /* ignore */
  }
}

export function rememberLastProject(id: string) {
  if (!isSafeProjectId(id)) return;
  try {
    window.localStorage.setItem(LAST_PROJECT_KEY, id);
  } catch {
    /* ignore */
  }
}

export function readLastProjectId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const id = window.localStorage.getItem(LAST_PROJECT_KEY);
    return id && isSafeProjectId(id) ? id : null;
  } catch {
    return null;
  }
}

export function markStartupApplied() {
  try {
    window.sessionStorage.setItem(STARTUP_SESSION_KEY, "1");
  } catch {
    /* ignore */
  }
}

export function hasStartupApplied(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.sessionStorage.getItem(STARTUP_SESSION_KEY) === "1";
  } catch {
    return false;
  }
}
