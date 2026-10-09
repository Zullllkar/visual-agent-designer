"use client";

import { Image as ImageIcon, Puzzle, Sparkles } from "lucide-react";
import {
  SLASH_GROUP_LABEL,
  type SlashItem,
  type SlashItemKind,
} from "@/lib/chat/composer-slash";

const KIND_ICON: Record<SlashItemKind, typeof Sparkles> = {
  asset: ImageIcon,
  skill: Puzzle,
  command: Sparkles,
};

export function ComposerSlashMenu({
  items,
  activeIndex,
  onHover,
  onSelect,
}: {
  items: SlashItem[];
  activeIndex: number;
  onHover: (index: number) => void;
  onSelect: (item: SlashItem) => void;
}) {
  if (items.length === 0) {
    return (
      <div className="vad-slash-menu" role="listbox" aria-label="斜杠菜单">
        <p className="vad-slash-empty">没有匹配的素材、Skill 或快捷命令。</p>
      </div>
    );
  }

  let lastKind: SlashItemKind | null = null;
  return (
    <div className="vad-slash-menu" role="listbox" aria-label="斜杠菜单">
      {items.map((item, index) => {
        const showGroup = item.kind !== lastKind;
        lastKind = item.kind;
        const Icon = KIND_ICON[item.kind];
        return (
          <div key={item.id}>
            {showGroup ? (
              <p className="vad-slash-group">{SLASH_GROUP_LABEL[item.kind]}</p>
            ) : null}
            <button
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              className={
                "vad-slash-item" + (index === activeIndex ? " is-active" : "")
              }
              onMouseEnter={() => onHover(index)}
              onMouseDown={(event) => {
                event.preventDefault();
                onSelect(item);
              }}
            >
              <Icon className="size-3.5 shrink-0 opacity-70" />
              <span className="min-w-0 truncate">{item.label}</span>
              <span className="vad-slash-item-hint">{item.hint}</span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
