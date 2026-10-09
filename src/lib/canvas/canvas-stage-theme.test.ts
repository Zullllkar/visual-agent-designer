import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CANVAS_CHROME } from "./canvas-chrome";

function readCss(rel: string) {
  return readFileSync(resolve(process.cwd(), rel), "utf8");
}

describe("canvas stage matches the IDE page", () => {
  it("light chrome canvasBg equals :root --background", () => {
    const globals = readCss("src/app/globals.css");
    const root = globals.match(/:root \{[\s\S]*?--background:\s*([^;]+);/);
    expect(root?.[1].trim()).toBe(CANVAS_CHROME.light.canvasBg);
    expect(CANVAS_CHROME.light.canvasBg).toBe("#edeef1");
    expect(CANVAS_CHROME.light.surface).toBe("#ffffff");
    expect(CANVAS_CHROME.light.primary).toBe("#141416");
    expect(CANVAS_CHROME.dark.canvasBg).toBe("#0e0f12");
    expect(CANVAS_CHROME.dark.primary).toBe("#f2f3f5");
  });

  it("binds tldraw canvas fill to the page background token", () => {
    const shell = readCss("src/components/ide/ide-shell.css");
    expect(shell).toMatch(/--tl-color-background:\s*var\(--background\)/);
  });

  it("appearance picker uses canvas swatches instead of inverted pills", () => {
    const shell = readCss("src/components/ide/ide-shell.css");
    expect(shell).toMatch(/\.vad-canvas-appearance-preview\.is-dots/);
    expect(shell).toMatch(/\.vad-canvas-appearance-preview\.is-lines/);
    expect(shell).toMatch(/\.vad-canvas-appearance-preview\.is-none/);
    expect(shell).not.toMatch(
      /\.vad-canvas-appearance-seg-btn\.is-active \{\s*background: var\(--foreground\)/,
    );
  });

  it("cite spawn overlay does not swallow canvas pointer events", () => {
    const shell = readCss("src/components/ide/ide-shell.css");
    const block = shell.match(/\.vad-cite-layer \{[^}]+\}/);
    expect(block?.[0]).toMatch(/pointer-events:\s*none/);
  });

  it("hides the artwork strip from the appearance menu store flag", () => {
    const strip = readFileSync(
      resolve(process.cwd(), "src/components/ide/canvas-artwork-strip.tsx"),
      "utf8",
    );
    expect(strip).toMatch(/appearanceMenuOpen/);
  });

  it("lets tldraw own image double-click zoom and box resize", () => {
    const shape = readFileSync(
      resolve(process.cwd(), "src/components/ide/image-asset-shape.tsx"),
      "utf8",
    );
    expect(shape).toMatch(/override onDoubleClick/);
    expect(shape).toMatch(/zoomToSelection/);
    expect(shape).toMatch(/resizeBox/);
  });

  it("lets generating and empty image slots be removed on pointer up", () => {
    const shape = readFileSync(
      resolve(process.cwd(), "src/components/ide/image-asset-shape.tsx"),
      "utf8",
    );
    expect(shape).toMatch(/vad-artwork-photo-remove/);
    expect(shape).toMatch(/onPointerUp/);
    expect(shape).toMatch(/pointerEvents:\s*"auto"/);
    expect(shape).toMatch(
      /const canRemovePlaceholder = isFailed \|\| showLoading \|\| isEmptySlot/,
    );
  });

  it("deletes text notes on pointer up instead of a cancelled click", () => {
    const shape = readFileSync(
      resolve(process.cwd(), "src/components/ide/text-note-shape.tsx"),
      "utf8",
    );
    expect(shape).toMatch(/vad-text-note-remove/);
    expect(shape).toMatch(/onPointerUp/);
    expect(shape).toMatch(/remove\(\)/);
  });

  it("syncs canvas notes onto the board when they are added or deleted", () => {
    const pane = readFileSync(
      resolve(process.cwd(), "src/components/ide/canvas-pane.tsx"),
      "utf8",
    );
    expect(pane).toMatch(/canvasNotes/);
  });

  it("shows a prompt composer under a linked placeholder", () => {
    const bar = readFileSync(
      resolve(process.cwd(), "src/components/ide/selection-floating-bar.tsx"),
      "utf8",
    );
    expect(bar).toMatch(/vad-spawn-prompt/);
    expect(bar).toMatch(/描述你想要生成的内容/);
    expect(bar).toMatch(/shouldShowSpawnPromptComposer/);
  });

  it("shows loading on empty spawn placeholders while an image job runs", () => {
    const shape = readFileSync(
      resolve(process.cwd(), "src/components/ide/image-asset-shape.tsx"),
      "utf8",
    );
    expect(shape).toMatch(/shouldShowSpawnSlotLoading/);
    expect(shape).toMatch(/imageJobBusy/);
    const chat = readFileSync(
      resolve(process.cwd(), "src/components/ide/chat-stream-view.tsx"),
      "utf8",
    );
    expect(chat).toMatch(/setImageJobBusy/);
    expect(chat).toMatch(/releaseStuckGeneratingAssets/);
  });

  it("mounts the cite port in front of the canvas instead of covering it", () => {
    const canvas = readFileSync(
      resolve(process.cwd(), "src/components/ide/tldraw-canvas.tsx"),
      "utf8",
    );
    expect(canvas).toMatch(/InFrontOfTheCanvas:\s*CitePortOverlay/);
    expect(canvas).not.toMatch(/<CitePortOverlay\s*\/>/);
  });
});
