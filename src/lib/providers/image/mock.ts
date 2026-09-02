import type { ImageProvider } from "./types";

export const MockImageProvider: ImageProvider = {
  name: "mock-image",
  async generateImage({ prompt, width, height, signal }) {
    await abortableDelay(150, signal);
    const svg = renderPlaceholderSvg({ prompt, width, height });
    const dataUrl = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
    return {
      imageUrl: dataUrl,
      model: "mock-image",
      seed: String(Math.floor(Math.random() * 1e6)),
      durationMs: 150,
    };
  },
};

function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Cancelled", "AbortError"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new DOMException("Cancelled", "AbortError"));
    }, { once: true });
  });
}

function renderPlaceholderSvg(opts: {
  prompt: string;
  width: number;
  height: number;
}) {
  const { prompt, width, height } = opts;
  const hue = Math.abs(hashCode(prompt)) % 360;
  const secondaryHue = (hue + 42) % 360;
  const accentHue = (hue + 210) % 360;
  const orb = Math.min(width, height) * 0.42;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="hsl(${hue}, 68%, 78%)" />
        <stop offset="52%" stop-color="hsl(${secondaryHue}, 68%, 67%)" />
        <stop offset="100%" stop-color="hsl(${accentHue}, 62%, 54%)" />
      </linearGradient>
      <radialGradient id="r" cx="68%" cy="28%" r="55%">
        <stop offset="0%" stop-color="rgba(255,255,255,0.72)" />
        <stop offset="100%" stop-color="rgba(255,255,255,0)" />
      </radialGradient>
      <pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse">
        <path d="M 32 0 L 0 0 0 32" fill="none" stroke="rgba(255,255,255,0.16)" stroke-width="1" />
      </pattern>
    </defs>
    <rect width="100%" height="100%" fill="url(#g)" />
    <rect width="100%" height="100%" fill="url(#grid)" />
    <circle cx="${width * 0.72}" cy="${height * 0.28}" r="${orb}" fill="url(#r)" />
    <rect x="${width * 0.12}" y="${height * 0.18}" width="${width * 0.46}" height="${height * 0.16}" rx="18" fill="rgba(255,255,255,0.34)" />
    <rect x="${width * 0.12}" y="${height * 0.41}" width="${width * 0.68}" height="${height * 0.36}" rx="24" fill="rgba(255,255,255,0.24)" />
    <rect x="${width * 0.18}" y="${height * 0.49}" width="${width * 0.26}" height="${height * 0.06}" rx="8" fill="rgba(255,255,255,0.44)" />
    <rect x="${width * 0.18}" y="${height * 0.61}" width="${width * 0.48}" height="${height * 0.045}" rx="7" fill="rgba(255,255,255,0.28)" />
  </svg>`;
}

function hashCode(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return h;
}
