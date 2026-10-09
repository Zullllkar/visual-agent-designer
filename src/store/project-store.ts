"use client";

/**
 * 项目状态 store
 * --------------------------------------------------------------
 * @author：wangjunhua
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { ProjectFile } from "@/lib/project/schema";
import { mergeAssetsPreferDiscarded } from "@/lib/project/asset-visibility";
import { mergeApiSrcFromDisk, mergeProjectWithDisk } from "@/lib/project/merge-project";
import { absorbIntoEmptySpawnSlots } from "@/lib/canvas/spawn-child-asset";
import { createIdbStorage } from "@/lib/storage/idb-storage";

export interface UpsertProjectOptions {
  /** 默认 true；流水线中间快照应设为 false，避免磁盘 POST 乱序冲掉 assets */
  syncToDisk?: boolean;
}

export type DiskSyncStatus = "idle" | "saving" | "saved" | "error";
export interface ProjectConflict { projectId: string; localRevision?: number; remoteRevision?: number; detectedAt: number; }

function finalizeProjectAssets(project: ProjectFile): ProjectFile {
  const assets = absorbIntoEmptySpawnSlots(project.assets ?? []);
  if (assets === project.assets) return project;
  return { ...project, assets };
}

function mergeProjectAssets(
  current: ProjectFile | undefined,
  incoming: ProjectFile
): ProjectFile {
  const merged = !current?.assets?.length
    ? incoming
    : {
        ...incoming,
        assets: mergeAssetsPreferDiscarded(current.assets, incoming.assets),
      };
  return finalizeProjectAssets(merged);
}

interface ProjectStoreState {
  projects: Record<string, ProjectFile>;
  diskSync: Record<string, DiskSyncStatus>;
  conflicts: Record<string, ProjectConflict>;
  getDiskSync: (id: string) => DiskSyncStatus;
  getConflict: (id: string) => ProjectConflict | undefined;
  clearConflict: (id: string) => void;
  upsert: (project: ProjectFile, options?: UpsertProjectOptions) => void;
  reloadFromDisk: (id: string) => Promise<ProjectFile | null>;
  remove: (id: string) => void;
  get: (id: string) => ProjectFile | undefined;
  list: () => ProjectFile[];
  importProjectsQuietly: (projects: ProjectFile[]) => void;
}

export const useProjectStore = create<ProjectStoreState>()(
  persist(
    (set, getState) => ({
      projects: {},
      diskSync: {},
      conflicts: {},
      getDiskSync: (id) => getState().diskSync[id] ?? "idle",
      getConflict: (id) => getState().conflicts[id],
      clearConflict: (id) => set((s) => { const conflicts = { ...s.conflicts }; delete conflicts[id]; return { conflicts }; }),
      upsert: (project, options) => {
        const nextProject = mergeProjectAssets(getState().projects[project.id], project);
        set((s) => ({
          projects: { ...s.projects, [nextProject.id]: nextProject },
        }));

        if (options?.syncToDisk === false) return;
        if (typeof window === "undefined") return;

        set((s) => ({
          diskSync: { ...s.diskSync, [project.id]: "saving" },
        }));

        const sentAt = nextProject.updatedAt;
        fetch("/api/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(nextProject),
        })
          .then((res) => res.json())
          .then((data) => {
            if (!data.success || !data.project) {
              set((s) => ({
                diskSync: { ...s.diskSync, [project.id]: "error" },
              }));
              return;
            }
            set((s) => {
              const cur = s.projects[project.id];
              const nextProjects = !cur
                ? { ...s.projects, [project.id]: finalizeProjectAssets(data.project) }
                : cur.updatedAt > data.project.updatedAt
                  ? {
                      ...s.projects,
                      [project.id]: finalizeProjectAssets(
                        mergeApiSrcFromDisk(cur, data.project)
                      ),
                    }
                  : data.project.updatedAt < sentAt
                    ? s.projects
                    : {
                        ...s.projects,
                        [project.id]: finalizeProjectAssets(
                          mergeProjectWithDisk(cur, data.project)
                        ),
                      };
              return {
                projects: nextProjects,
                diskSync: { ...s.diskSync, [project.id]: "saved" },
              };
            });
          })
          .catch((err) => {
            console.warn("[project-store] sync to disk failed:", err);
            set((s) => ({
              diskSync: { ...s.diskSync, [project.id]: "error" },
            }));
          });
      },
      reloadFromDisk: async (id) => {
        if (typeof window === "undefined") return null;
        try {
          const res = await fetch(`/api/projects/${id}`);
          const data = (await res.json()) as {
            project?: ProjectFile;
            error?: string;
          };
          if (!res.ok || !data.project) return null;
          const disk = data.project;
          const existing = getState().projects[id];
          if (!existing) {
            set((s) => ({
              projects: { ...s.projects, [id]: disk },
            }));
            return disk;
          }
          if ((disk.revision ?? 0) > (existing.revision ?? 0) && disk.updatedAt !== existing.updatedAt) {
            set((s) => ({ conflicts: { ...s.conflicts, [id]: { projectId: id, localRevision: existing.revision, remoteRevision: disk.revision, detectedAt: Date.now() } } }));
          }
          const merged = mergeProjectWithDisk(existing, disk);
          if (merged !== existing) {
            set((s) => ({
              projects: { ...s.projects, [id]: merged },
            }));
          }
          return merged;
        } catch (err) {
          console.warn("[project-store] reload from disk failed:", err);
          return getState().projects[id] ?? null;
        }
      },
      remove: (id) =>
        set((s) => {
          const next = { ...s.projects };
          delete next[id];
          return { projects: next };
        }),
      get: (id) => getState().projects[id],
      list: () =>
        Object.values(getState().projects).sort((a, b) =>
          b.updatedAt.localeCompare(a.updatedAt)
        ),
      importProjectsQuietly: (projects) => {
        set((s) => {
          const updated = { ...s.projects };
          let changed = false;
          projects.forEach((proj) => {
            const existing = updated[proj.id];
            if (!existing) {
              updated[proj.id] = proj;
              changed = true;
              return;
            }
            if (proj.updatedAt >= existing.updatedAt) {
              // 保留本地 discarded，避免列表同步把已删素材冲回来
              updated[proj.id] = mergeProjectWithDisk(existing, proj);
              changed = true;
            }
          });
          return changed ? { projects: updated } : {};
        });
      },
    }),
    {
      name: "vad.projects.v1",
      skipHydration: true,
      storage: createJSONStorage(() => createIdbStorage()),
      partialize: (s) => ({ projects: s.projects }),
    }
  )
);
