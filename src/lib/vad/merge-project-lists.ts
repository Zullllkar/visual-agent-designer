type ListedProject = {
  id: string;
  updatedAt?: string;
  [key: string]: unknown;
};

export function mergeProjectsById<T extends ListedProject>(
  preferred: T[],
  extra: T[],
): T[] {
  const byId = new Map<string, T>();
  for (const project of extra) byId.set(project.id, project);
  for (const project of preferred) byId.set(project.id, project);
  return [...byId.values()].sort((a, b) =>
    String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")),
  );
}
