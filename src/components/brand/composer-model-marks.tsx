"use client";

import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ProviderLogo } from "@/components/brand/provider-logo";
import { composerImageSummary, composerLlmSummary, type ComposerModelMark } from "@/lib/providers/provider-marks";
import type { ProviderConfig } from "@/lib/providers/registry";
import "./composer-model-marks.css";

function ModelGlyph({ mark }: { mark: ComposerModelMark | null }) {
  if (mark?.kind === "logo") {
    return <ProviderLogo provider={mark.id} className="is-row" />;
  }
  return <span className="composer-model-letter">{mark?.kind === "letter" ? mark.letter : "—"}</span>;
}

function ModelRow({
  kicker,
  name,
  mark,
}: {
  kicker: string;
  name: string;
  mark: ComposerModelMark | null;
}) {
  return (
    <div className="composer-model-row">
      <span className="composer-model-row-icon">
        <ModelGlyph mark={mark} />
      </span>
      <span className="composer-model-row-copy">
        <small>{kicker}</small>
        <strong>{name}</strong>
      </span>
    </div>
  );
}

export function ComposerModelChip({
  config,
  disabled,
  className,
  onOpenSettings,
}: {
  config?: ProviderConfig;
  disabled?: boolean;
  className?: string;
  onOpenSettings: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const llm = composerLlmSummary(config);
  const image = composerImageSummary(config);

  useEffect(() => {
    if (!open) return;
    function close(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  return (
    <div className="composer-model-menu" ref={rootRef}>
      <button
        type="button"
        className={className}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`语言模型 ${llm.name}`}
        title={llm.name}
        onClick={() => setOpen((current) => !current)}
      >
        {llm.mark?.kind === "logo" ? (
          <ProviderLogo provider={llm.mark.id} className="is-mark" />
        ) : null}
        <span className="composer-model-chip-label">{llm.name}</span>
        <ChevronDown className={`size-3 composer-model-chevron${open ? " is-open" : ""}`} aria-hidden />
      </button>
      {open ? (
        <div className="composer-model-popover" role="dialog" aria-label="当前模型">
          <ModelRow kicker="语言模型" name={llm.name} mark={llm.mark} />
          <ModelRow
            kicker="生图模型"
            name={image?.name ?? "还没配置"}
            mark={image?.mark ?? null}
          />
          <button
            type="button"
            className="composer-model-more"
            onClick={() => {
              setOpen(false);
              onOpenSettings();
            }}
          >
            更多模型
          </button>
        </div>
      ) : null}
    </div>
  );
}
