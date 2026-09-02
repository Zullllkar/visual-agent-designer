"use client";

import { Check, ChevronDown, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { SKILL_KIND_LABELS } from "@/lib/skills/kinds";
import type { SkillCatalogItem } from "@/lib/skills/schema";
import { isSkillCompatibleWithTarget } from "@/lib/skills/selection";
import { skillCardTitle } from "@/lib/skills/skill-preview";
import type { TargetId } from "@/lib/targets/catalog";

export function SkillPicker({
  skills,
  value,
  targetId,
  onChange,
  disabled,
  inline = false,
  variant = "default",
}: {
  skills: SkillCatalogItem[];
  value?: string;
  targetId: TargetId;
  onChange: (skill: SkillCatalogItem | undefined) => void;
  disabled?: boolean;
  inline?: boolean;
  variant?: "default" | "composer";
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = skills.find((skill) => skill.name === value);
  const selectedTitle = selected ? skillCardTitle(selected) : "先不绑 Skill";
  const pickerClass = [
    "vad-skill-picker",
    inline ? "vad-skill-picker--inline" : "",
    variant === "composer" ? "vad-skill-picker--composer" : "",
  ]
    .filter(Boolean)
    .join(" ");

  useEffect(() => {
    if (inline || !open) return;
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [inline, open]);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return skills
      .filter((skill) => {
        if (!needle) return true;
        const title = skillCardTitle(skill).toLowerCase();
        return (
          title.includes(needle) ||
          skill.name.toLowerCase().includes(needle) ||
          skill.description.toLowerCase().includes(needle) ||
          SKILL_KIND_LABELS[skill.kind].includes(query.trim())
        );
      })
      .sort((a, b) => {
        const compatibleA = isSkillCompatibleWithTarget(a.kind, targetId);
        const compatibleB = isSkillCompatibleWithTarget(b.kind, targetId);
        if (compatibleA !== compatibleB) return compatibleA ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  }, [query, skills, targetId]);

  return (
    <div ref={rootRef} className={pickerClass}>
      <button
        type="button"
        className={`vad-skill-trigger${selected ? "" : " is-idle"}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="vad-skill-trigger-copy">
          <small>Skill（可选）</small>
          <strong className={selected ? undefined : "is-idle"}>{selectedTitle}</strong>
        </span>
        <ChevronDown
          className={`size-3.5 vad-skill-chevron${open ? " is-open" : ""}`}
          aria-hidden
        />
      </button>

      {open ? (
        <div className="vad-skill-menu" role="listbox" aria-label="选择 Skill">
          <label className="vad-skill-search">
            <Search className="size-3.5" aria-hidden />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索 Skill"
              aria-label="搜索 Skill"
            />
          </label>

          <div className="vad-skill-list">
            <button
              type="button"
              role="option"
              aria-selected={!selected}
              className="vad-skill-option"
              onClick={() => {
                onChange(undefined);
                setOpen(false);
              }}
            >
              <span>
                <strong>先不绑 Skill</strong>
                <small>默认 · 不按配方约束画面</small>
              </span>
              {!selected ? <Check className="size-3.5" aria-hidden /> : null}
            </button>

            {shown.map((skill) => {
              const compatible = isSkillCompatibleWithTarget(skill.kind, targetId);
              const active = skill.name === value;
              return (
                <button
                  key={skill.name}
                  type="button"
                  role="option"
                  aria-selected={active}
                  disabled={!compatible}
                  className="vad-skill-option"
                  onClick={() => {
                    onChange(skill);
                    setOpen(false);
                  }}
                >
                  <span>
                    <strong>{skillCardTitle(skill)}</strong>
                    <small>
                      {SKILL_KIND_LABELS[skill.kind]}
                      {!compatible ? " · 当前目标不适用" : ""}
                    </small>
                  </span>
                  {active ? <Check className="size-3.5" aria-hidden /> : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
