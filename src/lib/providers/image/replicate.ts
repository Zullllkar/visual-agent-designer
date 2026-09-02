/**
 * Replicate 图像生成 Provider
 * --------------------------------------------------------------
 * 通过 Replicate API 调用 Flux / SDXL 等高质量图像模型。
 * 需要环境变量 REPLICATE_API_TOKEN 或用户配置 apiKey。
 */

import type {
  ImageProvider,
  ImageGenerateInput,
  ImageGenerateOutput,
} from "./types";

export interface ReplicateImageConfig {
  apiKey: string;
  /** 默认 flux-1.1-pro */
  model: string;
  /** 可选自定义 API base URL */
  baseURL?: string;
}

const DEFAULT_BASE_URL = "https://api.replicate.com/v1";
const DEFAULT_MODEL = "black-forest-labs/flux-1.1-pro";

export function createReplicateImageProvider(
  cfg: ReplicateImageConfig
): ImageProvider {
  const baseURL = cfg.baseURL ?? DEFAULT_BASE_URL;
  const model = cfg.model || DEFAULT_MODEL;
  const apiToken = cfg.apiKey;

  return {
    name: "replicate",

    async generateImage(
      input: ImageGenerateInput
    ): Promise<ImageGenerateOutput> {
      const start = Date.now();

      // 创建 prediction
      const createRes = await fetch(`${baseURL}/predictions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
          Prefer: "wait",
        },
        signal: input.signal,
        body: JSON.stringify({
          input: {
            prompt: input.prompt,
            width: input.width,
            height: input.height,
            ...(input.negativePrompt
              ? { negative_prompt: input.negativePrompt }
              : {}),
          },
          model,
        }),
      });

      if (!createRes.ok) {
        const errText = await createRes.text().catch(() => "");
        throw new Error(
          `Replicate 创建 prediction 失败: ${createRes.status} ${errText}`
        );
      }

      const prediction = (await createRes.json()) as {
        id: string;
        status: string;
        output?: string | string[];
        error?: string;
        urls?: { get: string };
      };

      // Prefer: wait 模式下可能直接返回结果
      if (prediction.status === "succeeded" && prediction.output) {
        const imageUrl = Array.isArray(prediction.output)
          ? prediction.output[0]
          : prediction.output;
        return {
          imageUrl,
          model,
          durationMs: Date.now() - start,
        };
      }

      // 轮询等待结果
      const pollUrl = prediction.urls?.get ?? `${baseURL}/predictions/${prediction.id}`;
      const maxAttempts = 60;
      for (let i = 0; i < maxAttempts; i++) {
        await abortableDelay(2000, input.signal);
        const pollRes = await fetch(pollUrl, {
          headers: { Authorization: `Bearer ${apiToken}` },
          signal: input.signal,
        });
        if (!pollRes.ok) continue;
        const pollData = (await pollRes.json()) as {
          status: string;
          output?: string | string[];
          error?: string;
        };
        if (pollData.status === "succeeded" && pollData.output) {
          const imageUrl = Array.isArray(pollData.output)
            ? pollData.output[0]
            : pollData.output;
          return {
            imageUrl,
            model,
            durationMs: Date.now() - start,
          };
        }
        if (pollData.status === "failed" || pollData.status === "canceled") {
          throw new Error(
            `Replicate prediction ${pollData.status}: ${pollData.error ?? "unknown"}`
          );
        }
      }

      throw new Error("Replicate prediction 超时（120s）");
    },
  };
}

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
