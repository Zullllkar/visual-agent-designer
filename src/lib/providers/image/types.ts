/**
 * Image Provider 抽象（骨架）
 * --------------------------------------------------------------
 * 已实现：Mock / OpenAI-compatible / SiliconFlow / Gemini Image (Nano Banana)。
 * 规划：ComfyUI / Replicate / fal.ai。
 */

export interface ImageGenerateInput {
  prompt: string;
  width: number;
  height: number;
  /** base64 或 url 形式的参考图。 */
  referenceImages?: string[];
  /** 可选 negative prompt。 */
  negativePrompt?: string;
  /** 取消 Agent/Job 时终止底层网络请求。 */
  signal?: AbortSignal;
}

export interface ImageGenerateOutput {
  imageUrl: string;
  model: string;
  seed?: string;
  cost?: number;
  /** 生成耗时（毫秒）。 */
  durationMs?: number;
}

export interface ImageProvider {
  name: string;
  generateImage(input: ImageGenerateInput): Promise<ImageGenerateOutput>;
}
