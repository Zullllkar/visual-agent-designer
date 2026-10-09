import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function read(rel: string) {
  return readFileSync(resolve(process.cwd(), rel), "utf8");
}

describe("studio home palette (landing-v5)", () => {
  it("locks PC homepage chrome to landing-v5 white rail, warm stage, terracotta accent", () => {
    const css = read("src/components/studio/studio-home.css");
    expect(css).toMatch(/--studio-chrome:\s*#ffffff/);
    expect(css).toMatch(/--studio-stage:\s*#edeef1/);
    expect(css).toMatch(/--studio-surface:\s*#ffffff/);
    expect(css).toMatch(/--studio-accent:\s*#141416/);
    expect(css).toMatch(/--studio-chip:\s*#e2e4e9/);
    expect(css).toMatch(/html\.dark \.studio-app\s*\{[\s\S]*--studio-stage:\s*#0e0f12/);
    expect(css).toMatch(/html\.dark \.studio-app\s*\{[\s\S]*--studio-accent:\s*#f2f3f5/);
  });

  it("paints the create chip and stage dots like landing-v5, not a filled primary CTA", () => {
    const css = read("src/components/studio/studio-home.css");
    const create = css.match(/\.studio-create \{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(create).toMatch(/background:\s*var\(--studio-chip\)/);
    expect(create).not.toMatch(/background:\s*var\(--primary\)/);
    expect(css).toMatch(/\.studio-stage-dots/);
    expect(css).toMatch(/rgba\(24,\s*24,\s*28,\s*0\.08\)/);
  });

  it("mounts the dotted stage on the shared studio frame", () => {
    const frame = read("src/components/studio/studio-frame.tsx");
    expect(frame).toMatch(/studio-stage-dots/);
  });

  it("joins the titlebar and sidebar into one cool-gray shell around a rounded white panel", () => {
    const css = read("src/components/studio/studio-home.css");
    expect(css).toMatch(/--studio-shell:\s*#edeef1/);
    expect(css).toMatch(/html\.dark:has\(\.studio-app\)\s*\{[\s\S]*--studio-shell:\s*#0e0f12/);
    expect(css).toMatch(/\.desktop-titlebar,\s*\nhtml\.vad-desktop:has\(\.studio-app\) \.desktop-statusbar\s*\{[\s\S]*background:\s*var\(--studio-shell\)/);
    expect(css).toMatch(/\.studio-app\s*\{[\s\S]*background:\s*var\(--studio-shell\)/);
    const sidebar = css.match(/\.studio-sidebar \{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(sidebar).toMatch(/background:\s*transparent/);
    expect(sidebar).toMatch(/border-right:\s*0/);
    const main = css.match(/\.studio-main \{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(main).toMatch(/margin:\s*10px 12px 12px 8px/);
    expect(main).toMatch(/border-radius:\s*16px/);
    expect(main).toMatch(/background:\s*var\(--studio-surface\)/);
  });

  it("previews light theme as the cool-gray shell and a white panel", () => {
    const dialog = read("src/components/settings/settings-dialog.tsx");
    const css = read("src/components/settings/settings-dialog.css");
    expect(dialog).toMatch(/hint:\s*"铝台墨钮"/);
    expect(dialog).not.toMatch(/画布纸面|陶土夜间/);
    expect(css).toMatch(
      /\.vad-theme-card\.is-light \.vad-theme-preview\s*\{[\s\S]*background:\s*#edeef1/,
    );
    expect(css).toMatch(
      /\.vad-theme-card\.is-light \.vad-theme-preview-main\s*\{[\s\S]*background:\s*#ffffff/,
    );
    const overlay = css.match(/\.vad-settings-overlay \{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(overlay).toMatch(/z-index:\s*200/);
    expect(overlay).toMatch(/background:\s*rgba\(22,\s*22,\s*22,\s*0\.55\)/);
    expect(overlay).toMatch(/backdrop-filter:\s*blur\(18px\)/);
    expect(css).not.toMatch(/html\.vad-desktop \.vad-settings-overlay/);
  });

  it("hides homepage scrollbars so the stage and rail stay overlay-clean", () => {
    const css = read("src/components/studio/studio-home.css");
    expect(css).toMatch(/\.studio-main[\s\S]*scrollbar-width:\s*none/);
    expect(css).toMatch(/\.studio-recent-list[\s\S]*scrollbar-width:\s*none/);
    expect(css).toMatch(/\.studio-main::-webkit-scrollbar[\s\S]*display:\s*none/);
  });

  it("attaches a MiniMax-style project folder picker under the composer", () => {
    const css = read("src/components/studio/studio-home.css");
    const launcher = read("src/components/brief-launcher.tsx");
    expect(css).toMatch(/\.studio-workspace \{/);
    expect(css).toMatch(/\.studio-composer-stack \{/);
    expect(launcher).toMatch(/WorkspacePicker/);
  });
});
