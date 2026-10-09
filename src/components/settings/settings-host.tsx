"use client";

import { useEffect, useState } from "react";
import {
  SettingsDialog,
  type SettingsSection,
} from "@/components/settings/settings-dialog";
import { SETTINGS_OPEN_EVENT } from "@/lib/settings/events";

export function SettingsHost() {
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<SettingsSection>("general");

  useEffect(() => {
    function onOpen(event: Event) {
      const next = (event as CustomEvent<SettingsSection>).detail;
      setSection(next || "general");
      setOpen(true);
    }
    window.addEventListener(SETTINGS_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(SETTINGS_OPEN_EVENT, onOpen);
  }, []);

  useEffect(() => {
    if (!open) return;
    const setScrim = window.vadDesktop?.setTitleBarScrim;
    if (typeof setScrim !== "function") return;
    setScrim(true);
    return () => setScrim(false);
  }, [open]);

  if (!open) return null;
  return (
    <SettingsDialog
      key={section}
      initialSection={section}
      onClose={() => setOpen(false)}
    />
  );
}
