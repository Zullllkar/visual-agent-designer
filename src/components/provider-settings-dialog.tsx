"use client";

import { useState, useEffect } from "react";
import { X, Cpu, Check, AlertCircle, Loader2, Copy, CheckCheck } from "lucide-react";
import { useProviderStore, LLM_PRESETS } from "@/store/provider-store";
import {
  IMAGE_PROVIDER_CATALOG,
  getImagePreset,
  type ImagePresetId,
} from "@/lib/providers/image/catalog";
import type { ProviderConfig } from "@/lib/providers/registry";
import {
  isGptImageModel,
  type OpenAIImageBackground,
  type OpenAIImageOutputFormat,
  type OpenAIImageQuality,
} from "@/lib/providers/image/openai-image-types";
import { isMockLlmConfig, isMockImageConfig } from "@/lib/providers/validate";
import {
  CONTENT_LOCALE_OPTIONS,
  CONTENT_TONE_OPTIONS,
  type ContentLocale,
  type ContentTone,
} from "@/lib/agents/content-preferences";
import { DaemonStatusHint } from "@/components/daemon-status-hint";

/**
 * Provider 设置对话框
 * --------------------------------------------------------------
 * 配置 LLM provider：选择预设 → 填写 baseURL / apiKey / model → 测试连通性。
 *
 * apiKey 仅写入当前浏览器 localStorage，转发给本机 Next API 后再发到目标服务，
 * 不会上传到第三方。
 */
export function ProviderSettingsDialog({
  onClose,
  initialTab = "providers",
}: {
  onClose: () => void;
  initialTab?: "providers" | "mcp";
}) {
  const { config, setConfig, clear } = useProviderStore();

  const initial = configToForm(config);
  const [kind, setKind] = useState<"mock" | "openai-compatible" | "anthropic" | "gemini" | "deepseek">(initial.kind);
  const [presetId, setPresetId] = useState<string>(initial.presetId);
  const [baseURL, setBaseURL] = useState(initial.baseURL);
  const [apiKey, setApiKey] = useState(initial.apiKey);
  const [model, setModel] = useState(initial.model);

  const [visionCritic, setVisionCritic] = useState<boolean>(
    config.visionCritic ?? false
  );

  const [activeTab, setActiveTab] = useState<"providers" | "mcp">(initialTab);
  const [mcpConfig, setMcpConfig] = useState<{
    nodePath: string;
    cliPath: string;
    cursorConfig: any;
  } | null>(null);

  const [copiedSection, setCopiedSection] = useState<string | null>(null);

  useEffect(() => {
    if (activeTab === "mcp" && !mcpConfig) {
      fetch("/api/mcp/config")
        .then((res) => res.json())
        .then((data) => setMcpConfig(data))
        .catch((err) => console.error("Failed to load MCP info", err));
    }
  }, [activeTab, mcpConfig]);

  function handleCopy(text: string, section: string) {
    navigator.clipboard.writeText(text);
    setCopiedSection(section);
    setTimeout(() => setCopiedSection(null), 2000);
  }

  // Image provider 独立于 LLM 配置（可以 LLM 走 mock、图像走真实服务反之亦然）
  const imgInitial = imageConfigToForm(config);
  const [imgKind, setImgKind] = useState<
    "mock" | "openai-compatible" | "siliconflow" | "gemini-image"
  >(imgInitial.kind);
  const [imgPresetId, setImgPresetId] = useState<ImagePresetId>(imgInitial.presetId);
  const [imgBaseURL, setImgBaseURL] = useState(imgInitial.baseURL);
  const [imgApiKey, setImgApiKey] = useState(imgInitial.apiKey);
  const [imgModel, setImgModel] = useState(imgInitial.model);
  const [imgQuality, setImgQuality] = useState<OpenAIImageQuality>(
    imgInitial.quality
  );
  const [imgOutputFormat, setImgOutputFormat] = useState<OpenAIImageOutputFormat>(
    imgInitial.outputFormat
  );
  const [imgBackground, setImgBackground] = useState<OpenAIImageBackground>(
    imgInitial.background
  );

  const [contentTone, setContentTone] = useState<ContentTone>(
    (config.sliders?.contentTone as ContentTone) ?? "professional"
  );
  const [contentLocale, setContentLocale] = useState<ContentLocale>(
    (config.sliders?.contentLocale as ContentLocale) ?? "zh-CN"
  );

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<
    | { ok: true; sample: string }
    | { ok: false; message: string }
    | null
  >(null);

  function choosePreset(nextPresetId: string) {
    setPresetId(nextPresetId);
    const preset = LLM_PRESETS.find((p) => p.id === nextPresetId);
    if (preset) setBaseURL(preset.baseURL);
    
    if (nextPresetId === "anthropic") setKind("anthropic");
    else if (nextPresetId === "gemini") setKind("gemini");
    else if (nextPresetId === "deepseek") setKind("deepseek");
    else setKind("openai-compatible");
  }

  function chooseImgPreset(nextImgPresetId: ImagePresetId) {
    setImgPresetId(nextImgPresetId);
    const preset = getImagePreset(nextImgPresetId);
    setImgKind(preset.kind);
    setImgModel(preset.defaultModel);
    setImgBaseURL(preset.defaultBaseURL);
    if (nextImgPresetId === "openai-gpt-image") {
      setImgQuality("auto");
      setImgOutputFormat("png");
      setImgBackground("auto");
    }
  }

  const activeImgPreset = getImagePreset(imgPresetId);
  const imgModelOptions = activeImgPreset.models;
  const imgModelInCatalog = imgModelOptions.some((m) => m.id === imgModel);

  function buildImageConfig(): ProviderConfig["image"] {
    if (imgKind === "mock" || !imgApiKey || !imgModel) {
      return { kind: "mock" };
    }
    if (imgKind === "gemini-image") {
      return {
        kind: "gemini-image",
        apiKey: imgApiKey,
        model: imgModel,
        baseURL: imgBaseURL || activeImgPreset.defaultBaseURL,
      };
    }
    if (imgKind === "siliconflow") {
      return {
        kind: "siliconflow",
        apiKey: imgApiKey,
        model: imgModel,
        baseURL: imgBaseURL || activeImgPreset.defaultBaseURL,
      };
    }
    const gptImage = isGptImageModel(imgModel);
    return {
      kind: "openai-compatible",
      baseURL: imgBaseURL,
      apiKey: imgApiKey,
      model: imgModel,
      ...(gptImage
        ? {
            quality: imgQuality,
            outputFormat: imgOutputFormat,
            background: imgBackground,
          }
        : {}),
    };
  }

  function save() {
    const imageCfg = buildImageConfig();

    const sliders = {
      ...config.sliders,
      contentTone,
      contentLocale,
    };

    const next: ProviderConfig =
      kind === "mock"
        ? { llm: { kind: "mock" }, image: imageCfg, sliders }
        : {
            llm: { kind, baseURL, apiKey, model } as ProviderConfig["llm"],
            image: imageCfg,
            visionCritic,
            sliders,
          };

    setConfig(next);
    onClose();
  }

  function buildDraftConfig(): ProviderConfig {
    const imageCfg = buildImageConfig();
    return kind === "mock"
      ? { llm: { kind: "mock" }, image: imageCfg, visionCritic }
      : {
          llm: { kind, baseURL, apiKey, model } as ProviderConfig["llm"],
          image: imageCfg,
          visionCritic,
        };
  }

  async function test() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/providers/health", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          providerConfig: buildDraftConfig(),
          checkImage: true,
        }),
      });
      const data = (await res.json()) as {
        ready?: boolean;
        llm?: { ok: boolean; latencyMs?: number; error?: string; mock?: boolean };
        image?: { ok: boolean; latencyMs?: number; error?: string; mock?: boolean };
        message?: string;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data.message ?? data.error ?? `HTTP ${res.status}`);
      }
      const llmLine = data.llm?.ok
        ? `LLM ✓ ${data.llm.latencyMs ?? "?"}ms`
        : `LLM ✗ ${data.llm?.error ?? "失败"}`;
      const imgLine = data.image?.ok
        ? `生图 ✓ ${data.image.latencyMs ?? "?"}ms`
        : `生图 ✗ ${data.image?.error ?? "失败"}`;
      if (data.ready) {
        setTestResult({ ok: true, sample: `${llmLine}；${imgLine}` });
      } else {
        setTestResult({
          ok: false,
          message: `${llmLine}；${imgLine}`,
        });
      }
    } catch (err) {
      setTestResult({ ok: false, message: (err as Error).message });
    } finally {
      setTesting(false);
    }
  }

  const isRealAI = kind !== "mock";
  const valid = !isRealAI || (apiKey && model && (kind !== "openai-compatible" || baseURL));
  const imgConfigured =
    imgKind !== "mock" && !!imgApiKey && !!imgModel;
  const agentReady = isRealAI && !!apiKey && !!model && imgConfigured;

  const draftConfig: ProviderConfig =
    kind === "mock"
      ? { llm: { kind: "mock" }, image: imgConfigured ? { kind: imgKind, baseURL: imgBaseURL, apiKey: imgApiKey, model: imgModel } as ProviderConfig["image"] : { kind: "mock" } }
      : {
          llm: { kind, baseURL, apiKey, model } as ProviderConfig["llm"],
          image: imgConfigured
            ? ({ kind: imgKind, baseURL: imgBaseURL, apiKey: imgApiKey, model: imgModel } as ProviderConfig["image"])
            : { kind: "mock" },
        };
  const showAgentWarning =
    isMockLlmConfig(draftConfig) || isMockImageConfig(draftConfig);

  return (
    <div
      className="app-dialog-overlay"
      onClick={onClose}
    >
      <div
        className="app-dialog app-dialog-lg max-h-[90vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-base font-bold app-strong">
              <Cpu className="size-4.5 app-accent-text" />
              模型 Provider 设置
            </h2>
            <p className="mt-1.5 text-xs app-subtle font-medium">
              Agent 工作流需要同时配置 <strong className="app-strong">LLM</strong>（推理编排）与 <strong className="app-strong">生图模型</strong>（UI 位图资产）。Mock 仅用于本地 UI 调试。
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-1.5 app-subtle transition hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)]"
            aria-label="关闭"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Tab 导航切换 */}
        <div className="mt-4 flex border-b app-border">
          <button
            type="button"
            onClick={() => setActiveTab("providers")}
            className={`flex-1 pb-2.5 text-center text-xs font-bold transition-all duration-200 border-b-2 ${
              activeTab === "providers"
                ? "border-[var(--primary)] text-[var(--primary)]"
                : "border-transparent app-subtle hover:text-[var(--foreground)]"
            }`}
          >
            云端 / 本地模型配置
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("mcp")}
            className={`flex-1 pb-2.5 text-center text-xs font-bold transition-all duration-200 border-b-2 ${
              activeTab === "mcp"
                ? "border-[var(--primary)] text-[var(--primary)]"
                : "border-transparent app-subtle hover:text-[var(--foreground)]"
            }`}
          >
            MCP 终端直连 (Cursor)
          </button>
        </div>

        {activeTab === "providers" ? (
          <div className="max-h-[62vh] overflow-y-auto mt-4 pr-1 space-y-5">
            {showAgentWarning ? (
              <div className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900">
                <AlertCircle className="size-4 shrink-0 text-amber-600" />
                <div>
                  <p className="font-semibold">Agent 模式未就绪</p>
                  <p className="mt-0.5 leading-relaxed text-amber-800/90">
                    请配置真实 LLM 与生图 API。未配置时生成/对话将返回 400 错误。
                    开发调试可设置环境变量 <code className="rounded bg-amber-100 px-1">VAD_ALLOW_MOCK_DEV=true</code>。
                  </p>
                </div>
              </div>
            ) : agentReady ? (
              <div className="flex gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs text-emerald-900">
                <Check className="size-4 shrink-0 text-emerald-600" />
                <p>
                  <span className="font-semibold">Agent 模式已就绪</span>
                  ：LLM 负责编排与设计推理，生图模型负责 UI 位图资产。
                </p>
              </div>
            ) : null}
            <DaemonStatusHint />
            <div className="flex gap-2 rounded-2xl border app-border bg-[var(--surface-muted)] p-1.5">
              <RadioPill
                active={kind === "mock"}
                onClick={() => setKind("mock")}
                label="Mock 演示"
                sub="无需配置 API Key，启发式数据回退"
              />
              <RadioPill
                active={kind !== "mock"}
                onClick={() => {
                  if (presetId === "anthropic") setKind("anthropic");
                  else if (presetId === "gemini") setKind("gemini");
                  else if (presetId === "deepseek") setKind("deepseek");
                  else setKind("openai-compatible");
                }}
                label="智能大模型"
                sub="Claude / GPTs / DeepSeek / Gemini"
              />
            </div>

            <div>
              <h3 className="mb-2.5 text-[10px] font-bold uppercase tracking-wider app-subtle">
                ① 大语言模型 LLM Provider
              </h3>

              {isRealAI ? (
                <div className="space-y-4">
                  <div>
                    <label className="text-xs font-bold app-subtle">
                      服务预设
                    </label>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {LLM_PRESETS.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => choosePreset(p.id)}
                          className={
                            "rounded-xl border px-3 py-1.5 text-xs font-semibold transition-all duration-200 " +
                            (presetId === p.id
                              ? "border-[var(--border)] bg-[var(--primary-soft)] text-[var(--primary)] shadow-sm shadow-sm"
                              : "app-border app-surface app-strong hover:border-[var(--border)] hover:bg-[var(--surface-muted)]")
                          }
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <>
                    {(kind === "openai-compatible" || kind === "anthropic" || kind === "gemini") ? (
                      <Field
                        label="Base URL"
                        value={baseURL}
                        onChange={setBaseURL}
                        placeholder={
                          kind === "anthropic"
                            ? "https://api.anthropic.com"
                            : kind === "gemini"
                              ? "https://generativelanguage.googleapis.com"
                              : "https://api.openai.com/v1"
                        }
                        mono
                      />
                    ) : null}
                    <Field
                      label="API Key"
                      value={apiKey}
                      onChange={setApiKey}
                      placeholder="sk-..."
                      type="password"
                      mono
                    />
                    <Field
                      label="模型 Model ID"
                      value={model}
                      onChange={setModel}
                      placeholder={
                        LLM_PRESETS.find((p) => p.id === presetId)?.modelHint ??
                        "model id"
                      }
                      mono
                    />
                  </>

                  <label className="mt-2 flex cursor-pointer items-start gap-3 rounded-2xl border app-border bg-[var(--surface-muted)] p-3.5 hover:bg-[var(--surface-muted)] transition">
                    <input
                      type="checkbox"
                      checked={visionCritic}
                      onChange={(e) => setVisionCritic(e.target.checked)}
                      className="mt-0.5 size-4 rounded-md app-border text-[var(--primary)] focus:ring-[var(--primary)]"
                    />
                    <div className="flex-1">
                      <div className="text-xs font-bold app-strong">启用多模态 Vision Critic</div>
                      <p className="mt-1 text-[10px] leading-relaxed app-subtle font-medium">
                        将每页渲染为高保真 PNG 截图喂给视觉模型评审，捕捉单纯 JSON 层无法识别的重叠、截断或对比度缺陷（要求大模型原生支持多模态识图）。
                      </p>
                    </div>
                  </label>
                </div>
              ) : (
                <p className="rounded-2xl border app-border bg-[var(--surface-muted)] p-4 text-xs leading-relaxed app-subtle font-medium">
                  Mock 演示模式下：BriefAgent、LayoutAgent 均使用内置的场景规则启发式产出。适合无 Key 快速演示或验证整体工作流。
                </p>
              )}
            </div>

            <div>
              <h3 className="mb-2.5 text-[10px] font-bold uppercase tracking-wider app-subtle">
                ② 图像生成模型 Image Provider
              </h3>
              <div className="flex gap-2 rounded-2xl border app-border bg-[var(--surface-muted)] p-1.5">
                <RadioPill
                  active={imgKind === "mock"}
                  onClick={() => setImgKind("mock")}
                  label="Mock 演示"
                  sub="高保真 AI SVG 渐变占位图"
                />
                <RadioPill
                  active={imgKind !== "mock"}
                  onClick={() => {
                    if (imgKind === "mock") chooseImgPreset(imgPresetId);
                  }}
                  label="真实生图模型"
                  sub="DALL-E / gpt-image-2 / Gemini / FLUX"
                />
              </div>
              {imgKind !== "mock" ? (
                <div className="mt-3.5 space-y-4">
                  <div>
                    <label className="text-xs font-bold app-subtle">
                      服务预设
                    </label>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {IMAGE_PROVIDER_CATALOG.map((preset) => (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => chooseImgPreset(preset.id)}
                          className={
                            "rounded-xl border px-3 py-1.5 text-xs font-semibold transition-all duration-200 " +
                            (imgPresetId === preset.id
                              ? "border-[var(--border)] bg-[var(--primary-soft)] text-[var(--primary)] shadow-sm shadow-sm"
                              : "app-border app-surface app-strong hover:border-[var(--border)] hover:bg-[var(--surface-muted)]")
                          }
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <Field
                    label="接口地址 Base URL"
                    value={imgBaseURL}
                    onChange={setImgBaseURL}
                    placeholder={activeImgPreset.baseURLPlaceholder}
                    mono
                  />
                  <p className="-mt-2 text-[10px] leading-relaxed app-subtle font-medium">
                    {activeImgPreset.baseURLHint}
                  </p>
                  <Field
                    label="Image API Key"
                    value={imgApiKey}
                    onChange={setImgApiKey}
                    placeholder={
                      imgKind === "gemini-image" ? "AIza..." : "sk-..."
                    }
                    type="password"
                    mono
                  />
                  <div>
                    <label className="text-xs font-bold app-subtle">
                      推荐模型
                    </label>
                    <select
                      value={imgModelInCatalog ? imgModel : "__custom__"}
                      aria-label="生图模型快速选择"
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v !== "__custom__") setImgModel(v);
                      }}
                      className="mt-1.5 w-full rounded-xl border app-border app-surface px-3 py-2 text-xs font-medium app-strong"
                    >
                      {imgModelOptions.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label}
                          {m.note ? ` — ${m.note}` : ""}
                        </option>
                      ))}
                      {!imgModelInCatalog && imgModel ? (
                        <option value="__custom__">自定义: {imgModel}</option>
                      ) : (
                        <option value="__custom__">自定义模型 ID…</option>
                      )}
                    </select>
                  </div>
                  <Field
                    label="Model ID（可手动覆盖）"
                    value={imgModel}
                    onChange={setImgModel}
                    placeholder={activeImgPreset.modelHint}
                    mono
                  />
                  {imgKind === "openai-compatible" && isGptImageModel(imgModel) ? (
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div>
                        <label className="text-xs font-bold app-subtle">
                          Quality
                        </label>
                        <select
                          value={imgQuality}
                          aria-label="gpt-image 渲染质量"
                          onChange={(e) =>
                            setImgQuality(e.target.value as OpenAIImageQuality)
                          }
                          className="mt-1.5 w-full rounded-xl border app-border app-surface px-3 py-2 text-xs font-medium app-strong"
                        >
                          <option value="auto">auto</option>
                          <option value="low">low</option>
                          <option value="medium">medium</option>
                          <option value="high">high</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-xs font-bold app-subtle">
                          Output Format
                        </label>
                        <select
                          value={imgOutputFormat}
                          aria-label="gpt-image 输出格式"
                          onChange={(e) =>
                            setImgOutputFormat(
                              e.target.value as OpenAIImageOutputFormat
                            )
                          }
                          className="mt-1.5 w-full rounded-xl border app-border app-surface px-3 py-2 text-xs font-medium app-strong"
                        >
                          <option value="png">png</option>
                          <option value="jpeg">jpeg</option>
                          <option value="webp">webp</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-xs font-bold app-subtle">
                          Background
                        </label>
                        <select
                          value={imgBackground}
                          aria-label="gpt-image 背景模式"
                          onChange={(e) =>
                            setImgBackground(
                              e.target.value as OpenAIImageBackground
                            )
                          }
                          className="mt-1.5 w-full rounded-xl border app-border app-surface px-3 py-2 text-xs font-medium app-strong"
                        >
                          <option value="auto">auto</option>
                          <option value="opaque">opaque</option>
                          {!/^gpt-image-2/i.test(imgModel) ? (
                            <option value="transparent">transparent</option>
                          ) : null}
                        </select>
                      </div>
                      {/^gpt-image-2/i.test(imgModel) ? (
                        <p className="sm:col-span-3 text-[10px] text-amber-600 font-medium">
                          gpt-image-2 不支持 transparent 背景，已自动省略该参数。
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                  <p className="text-[10px] leading-relaxed app-subtle font-medium">
                    {imgKind === "gemini-image"
                      ? "Gemini generateContent + responseModalities IMAGE → inlineData Base64。"
                      : "OpenAI 兼容 /images/generations → Base64 或 URL。"}
                  </p>
                </div>
              ) : null}
            </div>

            <div>
              <h3 className="mb-2.5 text-[10px] font-bold uppercase tracking-wider app-subtle">
                ③ Content Agent 文案偏好
              </h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="text-xs font-bold app-subtle">语调</label>
                  <select
                    value={contentTone}
                    onChange={(e) => setContentTone(e.target.value as ContentTone)}
                    className="mt-1.5 w-full rounded-xl border app-border app-surface px-3 py-2 text-xs font-medium app-strong"
                  >
                    {CONTENT_TONE_OPTIONS.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-bold app-subtle">语言</label>
                  <select
                    value={contentLocale}
                    onChange={(e) =>
                      setContentLocale(e.target.value as ContentLocale)
                    }
                    className="mt-1.5 w-full rounded-xl border app-border app-surface px-3 py-2 text-xs font-medium app-strong"
                  >
                    {CONTENT_LOCALE_OPTIONS.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <p className="mt-2 text-[10px] leading-relaxed app-subtle font-medium">
                影响 Brief / 视觉方向文案与 Agent 回复语言；生图 prompt 会尽量跟随此偏好。
              </p>
            </div>

            {testResult ? (
              <div
                className={
                  "flex items-start gap-2.5 rounded-2xl border px-4 py-3.5 text-xs leading-relaxed font-semibold " +
                  (testResult.ok
                    ? "border-emerald-100 bg-emerald-50/40 text-emerald-800"
                    : "border-red-100 bg-red-50/40 text-red-800")
                }
              >
                {testResult.ok ? (
                  <Check className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                ) : (
                  <AlertCircle className="mt-0.5 size-4 shrink-0 text-red-600" />
                )}
                <span className="break-all">
                  {testResult.ok
                    ? `健康检查通过：${testResult.sample}`
                    : `健康检查未通过：${testResult.message}`}
                </span>
              </div>
            ) : null}

            <div className="flex items-center justify-between gap-3 border-t app-border pt-4">
              <button
                type="button"
                onClick={clear}
                className="text-xs font-bold app-subtle transition hover:text-[var(--foreground)]"
              >
                重置为默认
              </button>
              <div className="flex gap-2.5">
                <button
                  type="button"
                  onClick={test}
                  disabled={!valid || testing}
                  className="inline-flex h-10 items-center gap-2 rounded-2xl border app-border app-surface px-4 text-xs font-bold app-strong transition hover:bg-[var(--surface-muted)] disabled:opacity-50"
                >
                  {testing ? <Loader2 className="size-3.5 animate-spin app-subtle" /> : null}
                  测试连通
                </button>
                <button
                  type="button"
                  onClick={save}
                  disabled={!valid}
                  className="inline-flex h-10 items-center rounded-2xl app-primary px-5 text-xs font-bold shadow-md transition disabled:opacity-50"
                >
                  保存配置
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="max-h-[62vh] overflow-y-auto mt-4 pr-1 space-y-4">
            <div className="rounded-2xl app-accent-soft border app-border p-4 text-xs leading-relaxed app-subtle font-medium">
              <p className="font-bold app-strong text-sm mb-1">🔌 AI 协同设计：连接 Cursor</p>
              Model Context Protocol (MCP) 让 Cursor 可以读取 Visual Agent Designer 画布、产品规范与设计 Token，并在项目中落地前端代码。
            </div>

            {mcpConfig ? (
              <div className="space-y-4">
                <div className="rounded-2xl border app-border p-4 space-y-2.5 bg-[var(--surface-muted)]">
                  <div className="flex items-center justify-between">
                    <h4 className="font-bold text-xs app-strong flex items-center gap-1.5">
                      <Cpu className="size-3.5 app-accent-text" />
                      Cursor MCP 配置 (Stdio 模式)
                    </h4>
                    <button
                      type="button"
                      onClick={() => handleCopy(`${mcpConfig.nodePath}\n${mcpConfig.cliPath} mcp`, "cursor")}
                      className="inline-flex items-center gap-1 text-[11px] font-bold text-[var(--primary)] hover:text-[var(--primary-strong)]"
                    >
                      {copiedSection === "cursor" ? (
                        <>
                          <CheckCheck className="size-3 text-emerald-600" />
                          <span className="text-emerald-600">已复制</span>
                        </>
                      ) : (
                        <>
                          <Copy className="size-3" />
                          <span>复制参数</span>
                        </>
                      )}
                    </button>
                  </div>
                  <p className="text-[10px] app-subtle font-medium">
                    打开 Cursor ➜ Settings ➜ Features ➜ MCP，点击 <strong>+ Add New MCP Tool</strong>，填入：
                  </p>
                  <div className="text-[10px] space-y-1 app-strong bg-[var(--surface-muted)] p-2.5 rounded-xl border app-border font-medium leading-relaxed">
                    <div>• <strong>Name</strong>: <code className="text-[var(--primary)]">visual-agent-designer</code></div>
                    <div>• <strong>Type</strong>: <code>stdio</code></div>
                    <div>• <strong>Command</strong>: <code className="font-mono text-emerald-600 break-all">{mcpConfig.nodePath}</code></div>
                    <div>• <strong>Arguments</strong>: <code className="font-mono text-emerald-600 break-all">{mcpConfig.cliPath} mcp</code></div>
                  </div>
                </div>

                <div className="rounded-2xl border border-dashed app-border bg-[var(--surface-muted)] p-3.5">
                  <p className="font-bold text-xs app-strong mb-1.5">💡 在 Cursor 中怎么用？</p>
                  <p className="text-[10px] leading-relaxed app-subtle font-medium">
                    配置生效后，在 Cursor 对话中让 Agent 调用 MCP 工具 <code>get_latest_project</code>、<code>get_page_assets</code>，即可读取最新画布 SVG、文案与设计 Token 并生成代码。
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex h-32 items-center justify-center">
                <Loader2 className="size-6 animate-spin text-[var(--primary)]" />
              </div>
            )}

            <div className="flex items-center justify-end border-t app-border pt-4">
              <button
                type="button"
                onClick={onClose}
                className="app-btn-secondary inline-flex h-10 items-center justify-center rounded-2xl px-5 text-xs font-bold"
              >
                我知道了
              </button>
            </div>
          </div>
        )}

        <p className="mt-4 text-[10px] leading-relaxed app-subtle font-medium">
          API Key 仅本地保存在当前浏览器的 localStorage 中，所有请求转发均直接通过本机的 Next API 代理完成，100% 绝对不会外传。若想彻底抹除本地存储，请点击「重置为默认」或在浏览器 Application 存储面板中清空。
        </p>
      </div>
    </div>
  );
}

function imageConfigToForm(cfg: ProviderConfig) {
  const img = cfg.image;
  if (img && img.kind !== "mock") {
    if (img.kind === "gemini-image") {
      return {
        kind: "gemini-image" as const,
        presetId: "gemini-image" as const,
        baseURL: img.baseURL ?? getImagePreset("gemini-image").defaultBaseURL,
        apiKey: img.apiKey,
        model: img.model,
        quality: "auto" as OpenAIImageQuality,
        outputFormat: "png" as OpenAIImageOutputFormat,
        background: "auto" as OpenAIImageBackground,
      };
    }
    if (img.kind === "siliconflow") {
      return {
        kind: "siliconflow" as const,
        presetId: "siliconflow" as const,
        baseURL: img.baseURL ?? getImagePreset("siliconflow").defaultBaseURL,
        apiKey: img.apiKey,
        model: img.model,
        quality: "auto" as OpenAIImageQuality,
        outputFormat: "png" as OpenAIImageOutputFormat,
        background: "auto" as OpenAIImageBackground,
      };
    }
    const gptImage = isGptImageModel(img.model);
    return {
      kind: "openai-compatible" as const,
      presetId: (gptImage ? "openai-gpt-image" : "openai-dalle") as
        | "openai-dalle"
        | "openai-gpt-image",
      baseURL: img.baseURL ?? "https://api.openai.com/v1",
      apiKey: img.apiKey,
      model: img.model,
      quality: (img.quality ?? "auto") as OpenAIImageQuality,
      outputFormat: (img.outputFormat ?? "png") as OpenAIImageOutputFormat,
      background: (img.background ?? "auto") as OpenAIImageBackground,
    };
  }
  return {
    kind: "mock" as const,
    presetId: "openai-dalle" as const,
    baseURL: "https://api.openai.com/v1",
    apiKey: "",
    model: "",
    quality: "auto" as OpenAIImageQuality,
    outputFormat: "png" as OpenAIImageOutputFormat,
    background: "auto" as OpenAIImageBackground,
  };
}

function configToForm(cfg: ProviderConfig) {
  const llm = cfg.llm;
  if (llm && llm.kind !== "mock") {
    const kind = llm.kind as "openai-compatible" | "anthropic" | "gemini" | "deepseek";
    let presetId = "openai";
    if (kind === "anthropic") presetId = "anthropic";
    else if (kind === "gemini") presetId = "gemini";
    else if (kind === "deepseek") presetId = "deepseek";
    else {
      presetId = LLM_PRESETS.find((p) => p.baseURL === (llm as { baseURL?: string }).baseURL)?.id ?? "openai";
    }
    return {
      kind,
      presetId,
      baseURL: "baseURL" in llm ? (llm as { baseURL?: string }).baseURL ?? "" : "",
      apiKey: "apiKey" in llm ? (llm as { apiKey?: string }).apiKey ?? "" : "",
      model: "model" in llm ? (llm as { model?: string }).model ?? "" : "",
    };
  }
  return {
    kind: "mock" as const,
    presetId: "openai",
    baseURL: LLM_PRESETS[0].baseURL,
    apiKey: "",
    model: "",
  };
}

function RadioPill({
  active,
  onClick,
  label,
  sub,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  sub: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "flex flex-1 flex-col rounded-xl px-4 py-3 text-left border transition-all duration-200 " +
        (active
          ? "bg-[var(--primary-soft)] text-[var(--primary)] app-accent-border shadow-sm"
          : "border-transparent app-subtle hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)]")
      }
    >
      <span className="text-xs font-bold">{label}</span>
      <span className={"text-[10px] mt-1 font-semibold " + (active ? "text-[var(--primary)]/80" : "app-subtle")}>
        {sub}
      </span>
    </button>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  mono = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  mono?: boolean;
}) {
  return (
    <div className="flex flex-col">
      <label className="text-xs font-bold app-subtle uppercase tracking-wider mb-1.5">
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={
          "w-full rounded-xl border app-border app-surface px-3.5 py-2.5 text-xs font-semibold outline-none transition-all duration-200 placeholder:text-[var(--muted)] focus:border-[var(--primary)] focus:ring-4 focus:ring-[color-mix(in_srgb,var(--primary)_20%,transparent)] " +
          (mono ? "font-mono" : "")
        }
      />
    </div>
  );
}
