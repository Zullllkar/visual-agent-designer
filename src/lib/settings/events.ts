import type { SettingsSection } from "@/components/settings/settings-dialog";

export const SETTINGS_OPEN_EVENT = "vad-open-settings";

export function openSettings(section: SettingsSection = "general") {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<SettingsSection>(SETTINGS_OPEN_EVENT, { detail: section })
  );
}
