"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo } from "react";
import { openSettings } from "@/lib/settings/events";
import { STUDIO_COMMAND_EVENT, type StudioCommandDetail } from "@/lib/studio/commands";
import { importStudioProject } from "@/lib/studio/library";
import { readReduceMotion, writeReduceMotion } from "@/lib/studio/motion";
import { readStudioRail, writeStudioRail } from "@/lib/studio/rail";
import { useProjectStore } from "@/store/project-store";

function focusBrief() {
  const input = document.getElementById("studio-prompt-input");
  input?.scrollIntoView({ block: "center", behavior: "smooth" });
  if (input instanceof HTMLTextAreaElement) input.focus();
}

function runCommand(detail: StudioCommandDetail, router: ReturnType<typeof useRouter>) {
  switch (detail.id) {
    case "new-brief":
      router.push("/");
      window.setTimeout(focusBrief, 40);
      break;
    case "open-settings":
      openSettings(detail.section ?? "general");
      break;
    case "open-gallery":
      router.push("/#gallery");
      window.setTimeout(() => {
        document.getElementById("studio-gallery")?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }, 40);
      break;
    case "import-project":
      void importStudioProject().then((project) => {
        if (project) router.push(`/projects/${project.id}`);
      });
      break;
    case "open-vad-root":
      window.vadDesktop?.openPath("vadRoot");
      break;
    case "open-logs":
      window.vadDesktop?.openPath("logs");
      break;
    case "open-project":
      if (detail.projectId) router.push(`/projects/${detail.projectId}`);
      break;
    case "quit":
      window.vadDesktop?.window("close");
      break;
    case "toggle-rail":
      writeStudioRail(!readStudioRail());
      break;
    case "toggle-motion":
      writeReduceMotion(!readReduceMotion());
      break;
    default:
      break;
  }
}

export function DesktopCommands() {
  const router = useRouter();
  const projects = useProjectStore((state) => state.projects);
  const recents = useMemo(
    () =>
      Object.values(projects)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, 8)
        .map((project) => ({ id: project.id, title: project.title })),
    [projects]
  );

  useEffect(() => {
    function onCommand(event: Event) {
      const detail = (event as CustomEvent<StudioCommandDetail>).detail;
      if (detail) runCommand(detail, router);
    }
    window.addEventListener(STUDIO_COMMAND_EVENT, onCommand);
    const stop = window.vadDesktop?.onCommand?.((detail) => runCommand(detail, router));
    return () => {
      window.removeEventListener(STUDIO_COMMAND_EVENT, onCommand);
      stop?.();
    };
  }, [router]);

  useEffect(() => {
    window.vadDesktop?.setRecents?.(recents);
  }, [recents]);

  return null;
}
