import type { ProjectFile } from "./schema";

export function isStaleProjectWrite(incoming: ProjectFile, current: ProjectFile | null): boolean {
  return Boolean(
    current &&
      typeof current.revision === "number" &&
      typeof incoming.revision === "number" &&
      incoming.revision < current.revision,
  );
}

export function nextProjectRevision(incoming: ProjectFile, current: ProjectFile | null): ProjectFile {
  const currentRevision = current?.revision ?? 0;
  return { ...incoming, revision: Math.max(currentRevision + 1, (incoming.revision ?? 0) + 1) };
}
