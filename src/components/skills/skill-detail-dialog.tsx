"use client";

import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Copy,
  Download,
  FileText,
  Folder,
  Loader2,
  Save,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { MarkdownText } from "@/components/markdown-text";
import type { DesignSystemCatalogItem, SkillDetail, SkillManifest } from "@/lib/skills/schema";
import {
  skillDocumentTitle,
  splitSkillDocument,
  yamlPreviewSegments,
} from "@/lib/skills/skill-preview";

type SkillReference = { id: string; title: string };
type DetailFile = "skill" | "yaml";
type Validation =
  | { state: "idle" | "checking"; message: string; manifest?: undefined }
  | { state: "valid"; message: string; manifest: SkillManifest }
  | { state: "error"; message: string; manifest?: undefined };

const STEP_LABEL: Record<string, string> = {
  brief: "简报",
  architect: "架构",
  "design-director": "设计方向",
  layout: "布局",
  content: "文案",
  image: "出图",
  critic: "审查",
  repair: "修复",
};

function YamlLines({ text }: { text: string }) {
  const segments = useMemo(() => yamlPreviewSegments(text), [text]);
  return (
    <pre className="skill-yaml-pre">
      {segments.map((segment) =>
        segment.className ? (
          <span key={segment.key} className={segment.className}>
            {segment.text}
          </span>
        ) : (
          <span key={segment.key}>{segment.text}</span>
        ),
      )}
    </pre>
  );
}

export function SkillDetailDialog({
  creating,
  detail,
  raw,
  readonly,
  saving,
  dirty,
  error,
  notice,
  validation,
  designSystems,
  references,
  onClose,
  onChangeRaw,
  onSave,
  onInstall,
  onExport,
  onToggleEnabled,
  onRemove,
}: {
  creating: boolean;
  detail: SkillDetail | null;
  raw: string;
  readonly: boolean;
  saving: boolean;
  dirty: boolean;
  error: string | null;
  notice: string | null;
  validation: Validation;
  designSystems: DesignSystemCatalogItem[];
  references: SkillReference[];
  onClose: () => void;
  onChangeRaw: (value: string) => void;
  onSave: () => void;
  onInstall: () => void;
  onExport: () => void;
  onToggleEnabled: () => void;
  onRemove: () => void;
}) {
  const [file, setFile] = useState<DetailFile>("skill");
  const [editing, setEditing] = useState(creating);
  const [refsOpen, setRefsOpen] = useState(false);
  const parsed = useMemo(() => splitSkillDocument(raw), [raw]);
  const isBuiltin = detail?.origin === "builtin" && !creating;
  const manifest = validation.state === "valid" ? validation.manifest : detail;
  const title = skillDocumentTitle(raw, manifest?.description ?? "未命名 Skill");
  const steps = manifest?.agent.steps ?? [];
  const canEdit = !readonly && (creating || detail?.origin === "user");
  const recommended = designSystems.find(
    (system) => system.name === manifest?.recommendedDesignSystem,
  );

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function copyYaml() {
    void navigator.clipboard.writeText(parsed.yaml || raw);
  }

  return (
    <div className="skill-detail-overlay" role="presentation">
      <button type="button" className="skill-detail-backdrop" aria-label="关闭" onClick={onClose} />
      <div
        className="skill-detail-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="skill-detail-title"
      >
        <header className="skill-detail-head">
          <div>
            <div className="skill-detail-title-row">
              <h1 id="skill-detail-title">{title}</h1>
              {steps.length > 0 ? (
                <p className="skill-detail-tabs">
                  {steps.map((step) => (
                    <span key={step} className={step === steps[0] ? "is-current" : undefined}>
                      {STEP_LABEL[step] ?? step}
                    </span>
                  ))}
                </p>
              ) : null}
            </div>
            <p>{manifest?.description ?? "等待有效的 Skill 描述"}</p>
          </div>
          <button
            type="button"
            className="skill-detail-close"
            aria-label="关闭详情"
            onClick={onClose}
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="skill-detail-body">
          {error ? (
            <div className="skill-admin-alert is-error">
              <AlertCircle className="size-4" />
              {error}
            </div>
          ) : null}
          {notice ? (
            <div className="skill-admin-alert is-success">
              <CheckCircle2 className="size-4" />
              {notice}
            </div>
          ) : null}

          <div className="skill-detail-split">
            <aside className="skill-detail-files">
              <button
                type="button"
                className={`is-folder${refsOpen ? " is-open" : ""}`}
                onClick={() => setRefsOpen((open) => !open)}
              >
                <Folder className="size-3.5" />
                references
                <ChevronRight className="size-3 skill-detail-chevron" />
              </button>
              {refsOpen ? (
                references.length > 0 ? (
                  references.map((project) => (
                    <Link
                      key={project.id}
                      className="skill-detail-ref-item"
                      href={`/projects/${project.id}`}
                    >
                      {project.title}
                    </Link>
                  ))
                ) : (
                  <span className="skill-detail-ref-empty">暂无绑定项目</span>
                )
              ) : null}
              <button
                type="button"
                className={file === "yaml" ? "is-active" : ""}
                onClick={() => setFile("yaml")}
              >
                <FileText className="size-3.5" />
                meta.yaml
              </button>
              <button
                type="button"
                className={file === "skill" ? "is-active" : ""}
                onClick={() => setFile("skill")}
              >
                <FileText className="size-3.5" />
                SKILL.md
              </button>
            </aside>

            <div className="skill-detail-pane">
              {file === "yaml" ? (
                <section className="skill-yaml-card">
                  <div className="skill-yaml-card-head">
                    <span>YAML</span>
                    <button type="button" onClick={copyYaml} aria-label="复制 YAML">
                      <Copy className="size-3.5" />
                    </button>
                  </div>
                  <YamlLines text={parsed.yaml || "name: untitled"} />
                </section>
              ) : null}

              {file === "skill" ? (
                editing && canEdit ? (
                  <textarea
                    className="skill-detail-editor"
                    value={raw}
                    spellCheck={false}
                    aria-label="SKILL.md 内容"
                    onChange={(event) => onChangeRaw(event.target.value)}
                  />
                ) : (
                  <>
                    {parsed.yaml ? (
                      <section className="skill-yaml-card">
                        <div className="skill-yaml-card-head">
                          <span>YAML</span>
                          <button type="button" onClick={copyYaml} aria-label="复制 YAML">
                            <Copy className="size-3.5" />
                          </button>
                        </div>
                        <YamlLines text={parsed.yaml} />
                      </section>
                    ) : null}
                    <article className="skill-md-preview">
                      <MarkdownText content={parsed.markdown || "_这份 Skill 还没有正文。_"} />
                    </article>
                  </>
                )
              ) : null}
            </div>
          </div>
        </div>

        <footer className="skill-detail-foot">
          <div className="skill-detail-foot-meta">
            <span>
              {manifest?.name ?? "未命名"}
              {manifest?.version ? ` · v${manifest.version}` : ""}
              {recommended ? ` · ${recommended.description}` : ""}
            </span>
            {canEdit && !creating ? (
              <button
                type="button"
                className="studio-library-btn"
                onClick={() => setEditing((open) => !open)}
              >
                {editing ? "预览" : "编辑"}
              </button>
            ) : null}
            <button type="button" className="studio-library-btn" onClick={onExport}>
              <Download className="size-3.5" />
              导出
            </button>
            {detail?.origin === "user" && !creating ? (
              <>
                <button
                  type="button"
                  className="studio-library-btn"
                  disabled={saving}
                  onClick={onToggleEnabled}
                >
                  {detail.enabled ? "停用" : "启用"}
                </button>
                <button
                  type="button"
                  className="studio-library-btn"
                  disabled={saving || references.length > 0}
                  onClick={onRemove}
                >
                  <Trash2 className="size-3.5" />
                  删除
                </button>
              </>
            ) : null}
          </div>
          <div className="skill-detail-foot-actions">
            {canEdit && (creating || editing) ? (
              <button
                type="button"
                className="studio-library-btn is-primary"
                disabled={saving || validation.state !== "valid" || (!creating && !dirty)}
                onClick={onSave}
              >
                {saving ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Save className="size-3.5" />
                )}
                保存
              </button>
            ) : !isBuiltin ? (
              <button type="button" className="studio-library-btn" onClick={onInstall}>
                <Download className="size-3.5" />
                复制一份
              </button>
            ) : null}
          </div>
        </footer>
      </div>
    </div>
  );
}
