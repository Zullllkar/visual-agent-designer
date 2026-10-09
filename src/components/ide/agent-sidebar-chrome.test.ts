import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function read(rel: string) {
  return readFileSync(resolve(process.cwd(), rel), "utf8");
}

describe("agent sidebar chrome", () => {
  it("drops the pinned sidebar plan and the broken English stepper", () => {
    const src = read("src/components/ide/chat-stream-view.tsx");
    expect(src).not.toMatch(/function AgentPhaseStepper/);
    expect(src).not.toMatch(/<AgentPhaseStepper/);
    expect(src).not.toMatch(/当前阶段计算下/);
    expect(src).not.toMatch(/Run \/ Tool \/ Job/);
    expect(src).not.toMatch(/function AgentPlanCard/);
    expect(src).not.toMatch(/<AgentPlanCard/);
    expect(src).toMatch(/进行中/);
    expect(src).not.toMatch(/进行中\/失/);
    expect(src).toMatch(/accepted:\s*"已接受"/);
    expect(src).not.toMatch(/已接受」/);
  });

  it("labels image and send controls separately from run history", () => {
    const src = read("src/components/ide/chat-stream-view.tsx");
    const historyLabels = src.match(/aria-label="运行记录"/g) ?? [];
    expect(historyLabels).toHaveLength(1);
    expect(src).toMatch(/aria-label="添加图片"/);
    expect(src).toMatch(/aria-label="发送"/);
    expect(src).toMatch(/aria-label="排队发送"/);
    expect(src).not.toMatch(/text-white/);
  });

  it("paints the ready send button with the accent foreground token", () => {
    const css = read("src/app/globals.css");
    const ready = css.match(/\.vad-agent-send--ready \{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(ready).toMatch(/color:\s*var\(--vad-accent-fg-on\)/);
    expect(ready).not.toMatch(/color:\s*#fff/);
  });
});
