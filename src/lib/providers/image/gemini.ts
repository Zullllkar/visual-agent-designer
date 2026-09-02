import type { ImageGenerateInput, ImageProvider } from "./types";
import { fetchWithRetry } from "@/lib/providers/fetch-with-retry";

/**
 * Gemini Image Provider（Nano Banana 系列）
 * --------------------------------------------------------------
 * 通过 Gemini generateContent API 生成图像，支持：
 *   - gemini-2.5-flash-image（Nano Banana，默认）
 *   - gemini-3.1-flash-image（Nano Banana 2）
 *
 * 与 OpenAI /images/generations 不同，需设置 responseModalities: ["TEXT", "IMAGE"]。
 *
 * @author：wangjunhua
 */

export interface GeminiImageConfig {
  apiKey: string;
  /** 默认 gemini-2.5-flash-image */
  model: string;
  baseURL?: string;
  /** 可选：覆盖自动推断的宽高比 */
  aspectRatio?: GeminiAspectRatio;
}

export type GeminiAspectRatio =
  | "1:1"
  | "2:3"
  | "3:2"
  | "3:4"
  | "4:3"
  | "4:5"
  | "5:4"
  | "9:16"
  | "16:9"
  | "21:9";

const DEFAULT_MODEL = "gemini-3.1-flash-image";

export function createGeminiImageProvider(cfg: GeminiImageConfig): ImageProvider {
  const baseURL = cfg.baseURL ?? "https://generativelanguage.googleapis.com";
  const model = cfg.model || DEFAULT_MODEL;

  return {
    name: `gemini-image::${model}`,
    async generateImage(input: ImageGenerateInput) {
      const startedAt = Date.now();
      const cleanModel = model.replace(/^models\//, "");
      const url = `${joinURL(baseURL, `/v1beta/models/${cleanModel}:generateContent`)}?key=${cfg.apiKey}`;

      const aspectRatio =
        cfg.aspectRatio ?? pickAspectRatio(input.width, input.height);
      // Gemini 无原生 negative_prompt，并入正文
      const promptText = input.negativePrompt
        ? `${input.prompt}\n\nDo not include: ${input.negativePrompt}`
        : input.prompt;

      const body: Record<string, unknown> = {
        contents: [
          {
            role: "user",
            parts: [{ text: promptText }],
          },
        ],
        generationConfig: {
          responseModalities: ["TEXT", "IMAGE"],
          imageConfig: {
            aspectRatio,
          },
        },
      };

      if (input.referenceImages?.length) {
        const parts: Array<Record<string, unknown>> = [{ text: promptText }];
        for (const ref of input.referenceImages) {
          const parsed = parseDataUrl(ref);
          if (parsed) {
            parts.push({
              inlineData: {
                mimeType: parsed.mediaType,
                data: parsed.base64,
              },
            });
          }
        }
        body.contents = [{ role: "user", parts }];
      }

      const res = await fetchWithRetry(
        url,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: input.signal,
        },
        { timeoutMs: 480_000, maxAttempts: 3, signal: input.signal, shouldRetry: (err) => (err as { status?: number }).status === 429 }
      );

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Gemini Image HTTP ${res.status}: ${text.slice(0, 200)}`);
      }

      const data = (await res.json()) as GeminiImageResponse;
      const parts = data.candidates?.[0]?.content?.parts ?? [];
      const imagePart = parts.find((p) => p.inlineData?.data);

      if (!imagePart?.inlineData?.data) {
        throw new Error("Gemini Image response missing inlineData");
      }

      const mime = imagePart.inlineData.mimeType ?? "image/png";
      const imageUrl = `data:${mime};base64,${imagePart.inlineData.data}`;

      return {
        imageUrl,
        model,
        durationMs: Date.now() - startedAt,
      };
    },
  };
}

interface GeminiImageResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
        inlineData?: {
          mimeType?: string;
          data?: string;
        };
      }>;
    };
  }>;
}

function joinURL(base: string, path: string) {
  return base.replace(/\/+$/, "") + (path.startsWith("/") ? path : "/" + path);
}

function parseDataUrl(url: string): { mediaType: string; base64: string } | null {
  const match = url.match(/^data:([^;]+);base64,(.+)$/);
  if (match) return { mediaType: match[1], base64: match[2] };
  return null;
}

/** 按输入尺寸映射 Gemini 支持的 aspectRatio。 */
export function pickAspectRatio(w: number, h: number): GeminiAspectRatio {
  const ratio = w / Math.max(1, h);
  if (ratio > 1.7) return "16:9";
  if (ratio > 1.25) return "4:3";
  if (ratio > 1.05) return "5:4";
  if (ratio > 0.95) return "1:1";
  if (ratio > 0.72) return "4:5";
  if (ratio > 0.6) return "3:4";
  return "9:16";
}
