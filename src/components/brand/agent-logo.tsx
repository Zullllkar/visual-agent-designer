"use client";

import type { CSSProperties } from "react";
import { type SimpleIcon, siClaude, siCursor } from "simple-icons";
import { OPENAI_ICON } from "@/components/brand/provider-logo";
import type { BridgeAgentSlug } from "@/lib/bridge/client-types";
import { cn } from "@/lib/cn";

const AGENT_ICONS: Record<BridgeAgentSlug, SimpleIcon> = {
  cursor: siCursor,
  claude: siClaude,
  codex: OPENAI_ICON,
};

/** coding agent 图标：Cursor / Claude Code / Codex，与 ProviderLogo 视觉保持一致。 */
export function AgentLogo({ agent, className }: { agent: BridgeAgentSlug; className?: string }) {
  const icon = AGENT_ICONS[agent];
  // Cursor / Codex 使用前景色，Claude 使用品牌色
  const brand = agent === "claude" ? `#${icon.hex}` : "var(--foreground)";
  return (
    <span
      className={cn("vad-provider-logo vad-agent-logo", `vad-agent-logo--${agent}`, className)}
      style={{ "--brand-color": brand } as CSSProperties}
      title={icon.title}
    >
      <svg viewBox="0 0 24 24" role="img" aria-label={icon.title}>
        <path d={icon.path} fill="currentColor" />
      </svg>
    </span>
  );
}
