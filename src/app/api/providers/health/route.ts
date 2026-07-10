/**
 * POST /api/providers/health
 * --------------------------------------------------------------
 * 探测 LLM / 生图 Provider 连通性与延迟。
 *
 * @author：wangjunhua
 */

import { z } from "zod";
import { ProviderConfigSchema } from "@/lib/providers/config-schema";
import { resolveProviders } from "@/lib/providers/registry";
import { isMockLlmText } from "@/lib/providers/llm/utils";
import { withRetry } from "@/lib/providers/retry";

const InputSchema = z.object({
  providerConfig: ProviderConfigSchema,
  /** 是否探测生图（默认 true） */
  checkImage: z.boolean().optional(),
});

export async function POST(req: Request) {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = InputSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: "invalid_input" }, { status: 400 });
  }

  const { providerConfig, checkImage = true } = parsed.data;
  const { llm, image: imageProvider } = resolveProviders(providerConfig);

  const result: {
    llm: { ok: boolean; name: string; latencyMs?: number; error?: string; mock?: boolean };
    image?: { ok: boolean; name: string; latencyMs?: number; error?: string; mock?: boolean };
  } = {
    llm: { ok: false, name: llm.name },
  };

  const llmT0 = Date.now();
  try {
    const out = await withRetry(
      () =>
        llm.generateText({
          system: "You are a health check probe. Reply with exactly: OK",
          prompt: "ping",
        }),
      { maxAttempts: 2, timeoutMs: 25_000 }
    );
    const mock = isMockLlmText(out.text);
    result.llm = {
      ok: !mock,
      name: llm.name,
      latencyMs: Date.now() - llmT0,
      mock,
      error: mock ? "当前为 Mock LLM，请配置真实 API" : undefined,
    };
  } catch (e) {
    result.llm = {
      ok: false,
      name: llm.name,
      latencyMs: Date.now() - llmT0,
      error: (e as Error).message,
    };
  }

  if (checkImage) {
    const imgT0 = Date.now();
    try {
      const out = await withRetry(
        () =>
          imageProvider.generateImage({
            prompt: "solid gray square minimalist",
            width: 256,
            height: 256,
          }),
        { maxAttempts: 2, timeoutMs: 60_000 }
      );
      const mock =
        imageProvider.name.startsWith("mock") ||
        out.model === "mock-image" ||
        !out.imageUrl;
      result.image = {
        ok: !mock && !!out.imageUrl,
        name: imageProvider.name,
        latencyMs: Date.now() - imgT0,
        mock,
        error: mock ? "当前为 Mock 生图，请配置真实 API" : undefined,
      };
    } catch (e) {
      result.image = {
        ok: false,
        name: imageProvider.name,
        latencyMs: Date.now() - imgT0,
        error: (e as Error).message,
      };
    }
  }

  const ready =
    result.llm.ok && (!checkImage || (result.image?.ok ?? false));

  return Response.json({
    ready,
    ...result,
  });
}
