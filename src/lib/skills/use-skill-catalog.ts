"use client";

import { useEffect, useState } from "react";
import type { SkillCatalogResponse } from "./schema";

let cached: SkillCatalogResponse | null = null;
let pending: Promise<SkillCatalogResponse> | null = null;

export function invalidateSkillCatalog() {
  cached = null;
  pending = null;
}

async function fetchSkillCatalog(): Promise<SkillCatalogResponse> {
  if (cached) return cached;
  if (!pending) {
    pending = fetch("/api/skills")
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Skill catalog request failed: ${response.status}`);
        }
        const text = await response.text();
        if (!text.trim()) {
          throw new Error("Skill catalog request returned empty JSON");
        }
        return JSON.parse(text) as SkillCatalogResponse;
      })
      .then((catalog) => {
        cached = catalog;
        return catalog;
      })
      .finally(() => {
        pending = null;
      });
  }
  return pending;
}

export function useSkillCatalog() {
  const [catalog, setCatalog] = useState<SkillCatalogResponse | null>(cached);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void fetchSkillCatalog()
      .then((result) => {
        if (active) setCatalog(result);
      })
      .catch((reason: unknown) => {
        if (active) {
          setError(reason instanceof Error ? reason.message : "Skill catalog unavailable");
        }
      });
    return () => {
      active = false;
    };
  }, []);

  return {
    skills: catalog?.skills.filter((skill) => skill.enabled) ?? [],
    designSystems: catalog?.designSystems ?? [],
    loading: !catalog && !error,
    error,
  };
}
