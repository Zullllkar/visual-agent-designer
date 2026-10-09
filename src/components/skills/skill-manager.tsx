"use client";

import { FilePlus2, Loader2, Search, Upload } from "lucide-react";
import { type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SkillDetailDialog } from "@/components/skills/skill-detail-dialog";
import { SKILL_KIND_LABELS } from "@/lib/skills/kinds";
import type {
  DesignSystemCatalogItem,
  SkillCatalogItem,
  SkillDetail,
  SkillManifest,
} from "@/lib/skills/schema";
import { skillCardTitle } from "@/lib/skills/skill-preview";
import { invalidateSkillCatalog } from "@/lib/skills/use-skill-catalog";
import "./skill-manager.css";
import "@/components/studio/studio-library.css";

type SkillReference = { id: string; title: string };
type DetailResponse = { skill: SkillDetail; references: SkillReference[] };
type Shelf = "catalog" | "mine";
type KindFilter = "all" | SkillCatalogItem["kind"];
type Validation =
  | { state: "idle" | "checking"; message: string; manifest?: undefined }
  | { state: "valid"; message: string; manifest: SkillManifest }
  | { state: "error"; message: string; manifest?: undefined };

const NEW_SKILL_TEMPLATE = `---
name: my-new-skill
description: 描述这个 Skill 解决什么设计任务
kind: prototype
version: "1.0.0"
author: ""
inputs: []
output:
  artifact: canvas-pages
agent:
  steps:
    - brief
    - layout
    - image
    - critic
    - repair
  imageRequired: true
  repairThreshold: 8
  maxRepairRounds: 2
---

# Skill 指令

说明目标、工作流程、必须遵守的设计约束和交付标准。

## 质量要求

- 保持明确的视觉层级与一致间距
- 生成前检查输入是否完整
- 输出后进行视觉审查和必要修复
`;

async function readJson<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? `请求失败：${response.status}`);
  return payload;
}

function replaceSkillName(raw: string, name: string): string {
  return raw.replace(/^name:\s*.+$/m, `name: ${name}`);
}

function nextCopyId(id: string, skills: SkillCatalogItem[]): string {
  const used = new Set(skills.map((skill) => skill.name));
  let candidate = `${id}-copy`;
  let index = 2;
  while (used.has(candidate)) {
    candidate = `${id}-copy-${index}`;
    index += 1;
  }
  return candidate;
}

function skillKindLabel(kind: SkillCatalogItem["kind"]) {
  return SKILL_KIND_LABELS[kind];
}

const KIND_FILTERS: Array<[KindFilter, string]> = [
  ["all", "全部"],
  ...(Object.entries(SKILL_KIND_LABELS) as Array<[SkillCatalogItem["kind"], string]>),
];

export function SkillManager() {
  const importRef = useRef<HTMLInputElement>(null);
  const [skills, setSkills] = useState<SkillCatalogItem[]>([]);
  const [designSystems, setDesignSystems] = useState<DesignSystemCatalogItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SkillDetail | null>(null);
  const [references, setReferences] = useState<SkillReference[]>([]);
  const [raw, setRaw] = useState("");
  const [savedRaw, setSavedRaw] = useState("");
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState("");
  const [shelf, setShelf] = useState<Shelf>("catalog");
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [validation, setValidation] = useState<Validation>({
    state: "idle",
    message: "等待校验",
  });
  const dirty = raw !== savedRaw;

  const loadCatalog = useCallback(async (preferredId?: string) => {
    setLoading(true);
    try {
      const catalog = await readJson<{
        skills: SkillCatalogItem[];
        designSystems: DesignSystemCatalogItem[];
      }>(await fetch("/api/skills", { cache: "no-store" }));
      setSkills(catalog.skills);
      setDesignSystems(catalog.designSystems);
      setSelectedId((current) => {
        if (preferredId && catalog.skills.some((skill) => skill.name === preferredId)) {
          return preferredId;
        }
        if (current && catalog.skills.some((skill) => skill.name === current)) return current;
        return current;
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Skill 列表加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  useEffect(() => {
    if (!selectedId || creating) return;
    const controller = new AbortController();
    setDetailLoading(true);
    setError(null);
    void fetch(`/api/skills/${encodeURIComponent(selectedId)}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then((response) => readJson<DetailResponse>(response))
      .then((result) => {
        setDetail(result.skill);
        setReferences(result.references);
        setRaw(result.skill.raw);
        setSavedRaw(result.skill.raw);
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
      setError(reason instanceof Error ? reason.message : "Skill 列表加载失败");
      })
      .finally(() => setDetailLoading(false));
    return () => controller.abort();
  }, [creating, selectedId]);

  useEffect(() => {
    if (!raw.trim()) {
      setValidation({ state: "idle", message: "等待输入" });
      return;
    }
    const controller = new AbortController();
    setValidation({ state: "checking", message: "正在校验…" });
    const timer = window.setTimeout(() => {
      void fetch("/api/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "validate", raw }),
        signal: controller.signal,
      })
        .then((response) => readJson<{ valid: true; manifest: SkillManifest }>(response))
        .then((result) =>
          setValidation({
            state: "valid",
    message: "等待校验",
            manifest: result.manifest,
          }),
        )
        .catch((reason: unknown) => {
          if (reason instanceof DOMException && reason.name === "AbortError") return;
          setValidation({
            state: "error",
            message: reason instanceof Error ? reason.message : "校验失败",
          });
        });
    }, 450);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [raw]);

  const shownSkills = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return skills
      .filter((skill) => (shelf === "mine" ? skill.origin === "user" : skill.origin === "builtin"))
      .filter((skill) => kindFilter === "all" || skill.kind === kindFilter)
      .filter(
        (skill) =>
          !needle ||
          `${skill.name} ${skill.description} ${skill.kind}`.toLowerCase().includes(needle),
      )
      .sort((a, b) => a.description.localeCompare(b.description, "zh-CN"));
  }, [kindFilter, query, shelf, skills]);

  const editorOpen = creating || Boolean(selectedId);

  function guardDirty(): boolean {
    return !dirty || window.confirm("当前修改尚未保存，确定离开吗？");
  }

  function selectSkill(id: string) {
    if (!guardDirty()) return;
    setCreating(false);
    setSelectedId(id);
    setNotice(null);
  }

  function beginCreate(initialRaw = NEW_SKILL_TEMPLATE) {
    if (!guardDirty()) return;
    setShelf("mine");
    setCreating(true);
    setSelectedId(null);
    setDetail(null);
    setReferences([]);
    setRaw(initialRaw);
    setSavedRaw("");
    setNotice(null);
    setError(null);
  }

  async function save() {
    if (validation.state !== "valid") return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const response = creating
        ? await fetch("/api/skills", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "create", raw }),
          })
        : await fetch(`/api/skills/${encodeURIComponent(selectedId ?? "")}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ raw }),
          });
      const result = await readJson<{ skill: SkillDetail }>(response);
      invalidateSkillCatalog();
      setCreating(false);
      setDetail(result.skill);
      setSelectedId(result.skill.name);
      setRaw(result.skill.raw);
      setSavedRaw(result.skill.raw);
      setNotice("Skill 已保存并立即应用到后续运行");
      await loadCatalog(result.skill.name);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Skill 保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function toggleEnabled() {
    if (detail?.origin !== "user") return;
    setSaving(true);
    setError(null);
    try {
      const result = await readJson<{ skill: SkillDetail }>(
        await fetch(`/api/skills/${encodeURIComponent(detail.name)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: !detail.enabled }),
        }),
      );
      invalidateSkillCatalog();
      setDetail(result.skill);
      setNotice(result.skill.enabled ? "Skill 已启用" : "Skill 已停用");
      await loadCatalog(result.skill.name);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "状态更新失败");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (detail?.origin !== "user") return;
    if (!window.confirm(`确定永久删除 Skill “${detail.description}”吗？此操作无法撤销。`)) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await readJson<{ success: true }>(
        await fetch(`/api/skills/${encodeURIComponent(detail.name)}`, {
          method: "DELETE",
        }),
      );
      invalidateSkillCatalog();
      setDetail(null);
      setSelectedId(null);
      setRaw("");
      setSavedRaw("");
      setNotice("Skill 已保存并立即应用到后续运行");
      await loadCatalog();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Skill 删除失败");
    } finally {
      setSaving(false);
    }
  }

  function duplicate() {
    if (!raw || !detail) return;
    const copyId = nextCopyId(detail.name, skills);
    beginCreate(replaceSkillName(raw, copyId));
  }

  function exportSkill() {
    if (!raw) return;
    const id = validation.state === "valid" ? validation.manifest.name : "skill";
    const url = URL.createObjectURL(new Blob([raw], { type: "text/markdown" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${id}.SKILL.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function closeEditor() {
    if (!guardDirty()) return;
    setCreating(false);
    setSelectedId(null);
    setDetail(null);
    setRaw("");
    setSavedRaw("");
    setNotice(null);
    setError(null);
  }

  function importSkill(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    void file
      .text()
      .then((content) => beginCreate(content))
      .catch(() => setError("无法读取该文件"));
  }

  const isReadonly = detail?.origin === "builtin" && !creating;

  return (
    <div className="studio-library">
      <input
        ref={importRef}
        type="file"
        accept=".md,.markdown,text/markdown,text/plain"
        hidden
        onChange={importSkill}
      />

      <header className="studio-library-hero">
        <div>
          <h1>Skill</h1>
          <p>选择设计工作流，或导入、复制一份自己的 Skill</p>
          <div className="studio-library-actions">
            <button
              type="button"
              className="studio-library-btn"
              onClick={() => importRef.current?.click()}
            >
              <Upload className="size-3.5" />
              导入 Skill
            </button>
            <button
              type="button"
              className="studio-library-btn is-primary"
              onClick={() => beginCreate()}
            >
              <FilePlus2 className="size-3.5" />
              新建 Skill
            </button>
          </div>
        </div>
      </header>

      <div className="studio-library-toolbar">
        <div className="studio-library-tabs" role="tablist" aria-label="Skill 范围">
          <button
            type="button"
            role="tab"
            aria-selected={shelf === "catalog"}
            className={shelf === "catalog" ? "is-active" : ""}
            onClick={() => setShelf("catalog")}
          >
            Skill
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={shelf === "mine"}
            className={shelf === "mine" ? "is-active" : ""}
            onClick={() => setShelf("mine")}
          >
            我的 Skill
          </button>
        </div>

        <fieldset className="studio-library-kinds" aria-label="Skill 类型">
          {KIND_FILTERS.map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={kindFilter === value ? "is-active" : ""}
              onClick={() => setKindFilter(value)}
            >
              {label}
            </button>
          ))}
        </fieldset>

        <label className="studio-library-search">
          <Search className="size-3.5" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索 Skill"
            aria-label="搜索 Skill"
          />
        </label>
      </div>

      <section className="studio-library-section">
        <h2>{shelf === "mine" ? "我的 Skill" : "官方精选"}</h2>
        {loading ? (
          <div className="studio-empty">
            <Loader2 className="size-4 animate-spin" />
            正在读取 Skill…
          </div>
        ) : shownSkills.length === 0 ? (
          <div className="studio-empty">
            {shelf === "mine"
              ? "还没有自定义 Skill。可从官方精选复制，或直接新建。"
              : "没有符合筛选的 Skill"}
          </div>
        ) : (
          <div className="studio-gallery studio-gallery--skills">
            {shownSkills.map((skill) => {
              const title = skillCardTitle(skill);
              return (
                <button
                  key={`${skill.origin}:${skill.name}`}
                  type="button"
                  className={`studio-skill-card kind-${skill.kind}${
                    selectedId === skill.name && !creating ? " is-active" : ""
                  }`}
                  onClick={() => selectSkill(skill.name)}
                >
                  <span className="studio-skill-frame">
                    <span className="studio-skill-cover" aria-hidden>
                      <span className="studio-skill-sheet">
                        <b>{title}</b>
                        <i />
                        <i />
                        <i />
                      </span>
                    </span>
                  </span>
                  <span className="studio-skill-copy">
                    <strong>{title}</strong>
                    <em>
                      {skillKindLabel(skill.kind)}
                      {skill.origin === "builtin" ? " · 内置" : " · 自定义"}
                      {skill.enabled ? "" : " · 已停用"}
                    </em>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {editorOpen ? (
        detailLoading ? (
          <div className="skill-detail-overlay" role="presentation">
            <button
              type="button"
              className="skill-detail-backdrop"
              aria-label="关闭"
              onClick={closeEditor}
            />
            <div className="skill-detail-dialog is-loading">
              <Loader2 className="size-5 animate-spin" />
              正在打开 Skill…
            </div>
          </div>
        ) : (
          <SkillDetailDialog
            key={detail?.name ?? "new-skill"}
            creating={creating}
            detail={detail}
            raw={raw}
            readonly={isReadonly}
            saving={saving}
            dirty={dirty}
            error={error}
            notice={notice}
            validation={validation}
            designSystems={designSystems}
            references={references}
            onClose={closeEditor}
            onChangeRaw={setRaw}
            onSave={() => void save()}
            onInstall={duplicate}
            onExport={exportSkill}
            onToggleEnabled={() => void toggleEnabled()}
            onRemove={() => void remove()}
          />
        )
      ) : null}
    </div>
  );
}
