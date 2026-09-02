import type { ProjectFile } from "@/lib/project/schema";
import { projectExportFilename } from "@/lib/studio/project-actions";

export interface NativeFileFilter {
  name: string;
  extensions: string[];
}

export interface SaveTextFileInput {
  defaultPath: string;
  data: string;
  filters?: NativeFileFilter[];
}

export interface OpenTextFileInput {
  filters?: NativeFileFilter[];
}

const PROJECT_JSON_FILTERS: NativeFileFilter[] = [
  { name: "Project JSON", extensions: ["json"] },
];

export function downloadTextFile(defaultPath: string, data: string, mime = "application/json") {
  const blob = new Blob([data], { type: mime });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = defaultPath;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(href);
}

export async function saveTextFile(input: SaveTextFileInput): Promise<{
  ok: boolean;
  canceled?: boolean;
  path?: string;
}> {
  if (typeof window !== "undefined" && window.vadDesktop?.saveFile) {
    return window.vadDesktop.saveFile(input);
  }
  downloadTextFile(input.defaultPath, input.data);
  return { ok: true };
}

export async function openTextFile(input: OpenTextFileInput = {}): Promise<{
  ok: boolean;
  canceled?: boolean;
  data?: string;
  path?: string;
}> {
  if (typeof window !== "undefined" && window.vadDesktop?.openFile) {
    return window.vadDesktop.openFile(input);
  }
  return pickWithFileInput(input.filters ?? PROJECT_JSON_FILTERS);
}

function pickWithFileInput(filters: NativeFileFilter[]): Promise<{
  ok: boolean;
  canceled?: boolean;
  data?: string;
}> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    const accept = filters
      .flatMap((filter) => filter.extensions.map((ext) => `.${ext}`))
      .join(",");
    if (accept) input.accept = accept;
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) {
        resolve({ ok: false, canceled: true });
        return;
      }
      void file.text().then(
        (data) => resolve({ ok: true, data }),
        () => resolve({ ok: false })
      );
    });
    input.addEventListener("cancel", () => {
      resolve({ ok: false, canceled: true });
    });
    input.click();
  });
}

export { PROJECT_JSON_FILTERS };

export async function exportProjectJsonFile(project: ProjectFile) {
  await saveTextFile({
    defaultPath: projectExportFilename(project),
    data: JSON.stringify(project, null, 2),
    filters: PROJECT_JSON_FILTERS,
  });
}
