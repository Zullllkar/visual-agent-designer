"use client";

import {
  AlertCircle,
  Check,
  Cpu,
  Eye,
  EyeOff,
  Image as ImageIcon,
  KeyRound,
  Loader2,
  Network,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { useId, useState } from "react";
import { ProviderLogo } from "@/components/brand/provider-logo";
import { DaemonStatusHint } from "@/components/daemon-status-hint";
import {
  CONTENT_LOCALE_OPTIONS,
  CONTENT_TONE_OPTIONS,
  type ContentLocale,
  type ContentTone,
} from "@/lib/agents/content-preferences";
import {
  getImagePreset,
  IMAGE_PROVIDER_CATALOG,
  type ImagePresetId,
} from "@/lib/providers/image/catalog";
import {
  isGptImageModel,
  type OpenAIImageBackground,
  type OpenAIImageOutputFormat,
  type OpenAIImageQuality,
} from "@/lib/providers/image/openai-image-types";
import type { ProviderConfig } from "@/lib/providers/registry";
import { LLM_PRESETS, useProviderStore } from "@/store/provider-store";

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
  variant = "dialog",
}: {
  onClose?: () => void;
  variant?: "dialog" | "panel";
}) {
  const { config, setConfig, clear } = useProviderStore();

  const initial = configToForm(config);
  const [kind, setKind] = useState<"openai-compatible" | "anthropic" | "gemini" | "deepseek">(
    initial.kind,
  );
  const [presetId, setPresetId] = useState<string>(initial.presetId);
  const [baseURL, setBaseURL] = useState(initial.baseURL);
  const [apiKey, setApiKey] = useState(initial.apiKey);
  const [model, setModel] = useState(initial.model);
  const [showLlmKey, setShowLlmKey] = useState(false);
  const [showImageKey, setShowImageKey] = useState(false);
  const [saved, setSaved] = useState(false);

  const [visionCritic, setVisionCritic] = useState<boolean>(config.visionCritic ?? false);

  // Image provider 独立于 LLM 配置。
  const imgInitial = imageConfigToForm(config);
  const [imgKind, setImgKind] = useState<
    "openai-compatible" | "siliconflow" | "gemini-image" | "replicate"
  >(imgInitial.kind);
  const [imgPresetId, setImgPresetId] = useState<ImagePresetId>(imgInitial.presetId);
  const [imgBaseURL, setImgBaseURL] = useState(imgInitial.baseURL);
  const [imgApiKey, setImgApiKey] = useState(imgInitial.apiKey);
  const [imgModel, setImgModel] = useState(imgInitial.model);
  const [imgQuality, setImgQuality] = useState<OpenAIImageQuality>(imgInitial.quality);
  const [imgOutputFormat, setImgOutputFormat] = useState<OpenAIImageOutputFormat>(
    imgInitial.outputFormat,
  );
  const [imgBackground, setImgBackground] = useState<OpenAIImageBackground>(imgInitial.background);

  const [contentTone, setContentTone] = useState<ContentTone>(
    (config.sliders?.contentTone as ContentTone) ?? "professional",
  );
  const [contentLocale, setContentLocale] = useState<ContentLocale>(
    (config.sliders?.contentLocale as ContentLocale) ?? "zh-CN",
  );

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<
    { ok: true; sample: string } | { ok: false; message: string } | null
  >(null);

  function choosePreset(nextPresetId: string) {
    setPresetId(nextPresetId);
    const preset = LLM_PRESETS.find((p) => p.id === nextPresetId);
    if (preset) {
      setBaseURL(preset.baseURL);
      setModel(preset.models[0]?.id ?? "");
    }
    setTestResult(null);
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

  const activeLlmPreset = LLM_PRESETS.find((preset) => preset.id === presetId) ?? LLM_PRESETS[0];
  const llmModelInCatalog = activeLlmPreset.models.some((option) => option.id === model);
  const activeImgPreset = getImagePreset(imgPresetId);
  const imgModelOptions = activeImgPreset.models;
  const imgModelInCatalog = imgModelOptions.some((m) => m.id === imgModel);

  function buildImageConfig(): ProviderConfig["image"] {
    if (!imgApiKey || !imgModel) {
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
    if (imgKind === "replicate") {
      return {
        kind: "replicate",
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
    if (!imageCfg || imageCfg.kind === "mock") return;

    const sliders = {
      ...config.sliders,
      contentTone,
      contentLocale,
    };

    const next: ProviderConfig = {
      llm: { kind, baseURL, apiKey, model } as ProviderConfig["llm"],
      image: imageCfg,
      visionCritic,
      sliders,
    };

    setConfig(next);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1600);
    if (variant !== "panel") onClose?.();
  }

  function buildDraftConfig(): ProviderConfig {
    return {
      llm: { kind, baseURL, apiKey, model } as ProviderConfig["llm"],
      image: buildImageConfig(),
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

  const validLlm = Boolean(apiKey && model && (kind !== "openai-compatible" || baseURL));
  const imgConfigured = Boolean(imgApiKey && imgModel && imgBaseURL);
  const agentReady = validLlm && imgConfigured;
  const valid = agentReady;
  const showAgentWarning = !agentReady;

  const form = (
    <div
      className={
        variant === "panel" ? "space-y-5" : "max-h-[70vh] overflow-y-auto mt-4 pr-1 space-y-5"
      }
    >
      {showAgentWarning ? (
        <div className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900">
          <AlertCircle className="size-4 shrink-0 text-amber-600" />
          <div>
            <p className="font-semibold">Agent 模式未就绪</p>
            <p className="mt-0.5 leading-relaxed text-amber-800/90">
              请配置真实 LLM 与生图 API。未配置时生成/对话将返回 400 错误。 开发调试可设置环境变量{" "}
              <code className="rounded bg-amber-100 px-1">VAD_ALLOW_MOCK_DEV=true</code>。
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

      <div>
        <h3 className="mb-2.5 text-[10px] font-bold uppercase tracking-wider app-subtle">
          ① 大语言模型 LLM Provider
        </h3>

        <div className="space-y-4">
          <div>
            <div className="vad-provider-section-heading">
              <div>
                <span>推理服务</span>
                <strong>选择大模型提供商</strong>
              </div>
              <small>{LLM_PRESETS.length} 个连接器</small>
            </div>
            <div className="vad-provider-grid mt-3">
              {LLM_PRESETS.map((preset) => (
                <ProviderCard
                  key={preset.id}
                  active={presetId === preset.id}
                  name={preset.label}
                  company={preset.company}
                  description={preset.description}
                  badge={preset.badge}
                  icon={<ProviderLogo provider={preset.id} />}
                  onClick={() => choosePreset(preset.id)}
                />
              ))}
            </div>
          </div>

          <div className="vad-provider-config-panel">
            <div className="flex items-center gap-2 border-b app-border pb-3">
              <ProviderLogo provider={activeLlmPreset.id} compact />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold app-strong">{activeLlmPreset.label} 连接配置</p>
                <p className="truncate text-[10px] app-subtle">{activeLlmPreset.description}</p>
              </div>
              <Network className="size-4 app-subtle" />
            </div>
            {kind === "openai-compatible" || kind === "anthropic" || kind === "gemini" ? (
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
              placeholder={activeLlmPreset.apiKeyHint}
              type={showLlmKey ? "text" : "password"}
              mono
              icon={<KeyRound className="size-3.5" />}
              action={
                <button
                  type="button"
                  onClick={() => setShowLlmKey((value) => !value)}
                  aria-label={showLlmKey ? "隐藏 API Key" : "显示 API Key"}
                >
                  {showLlmKey ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                </button>
              }
            />
            <div>
              <span className="vad-provider-field-label">推荐模型</span>
              <select
                value={llmModelInCatalog ? model : "__custom__"}
                onChange={(event) => {
                  if (event.target.value !== "__custom__") setModel(event.target.value);
                }}
                className="vad-provider-select"
              >
                {activeLlmPreset.models.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label} — {option.note}
                  </option>
                ))}
                <option value="__custom__">自定义 Model ID</option>
              </select>
            </div>
            <Field
              label="Model ID（可手动覆盖）"
              value={model}
              onChange={setModel}
              placeholder={activeLlmPreset.modelHint}
              mono
              icon={<Cpu className="size-3.5" />}
            />
          </div>

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
                将每页渲染为高保真 PNG 截图喂给视觉模型评审，捕捉单纯 JSON
                层无法识别的重叠、截断或对比度缺陷（要求大模型原生支持多模态识图）。
              </p>
            </div>
          </label>
        </div>
      </div>

      <div>
        <h3 className="mb-2.5 text-[10px] font-bold uppercase tracking-wider app-subtle">
          ② 图像生成模型 Image Provider
        </h3>
        <div className="mt-3.5 space-y-4">
          <div>
            <div className="vad-provider-section-heading">
              <div>
                <span>视觉引擎</span>
                <strong>选择图像提供商</strong>
              </div>
              <small>{IMAGE_PROVIDER_CATALOG.length} 个连接器</small>
            </div>
            <div className="vad-provider-grid mt-3">
              {IMAGE_PROVIDER_CATALOG.map((preset) => (
                <ProviderCard
                  key={preset.id}
                  active={imgPresetId === preset.id}
                  name={preset.label}
                  company={preset.company}
                  description={preset.description}
                  badge={preset.badge}
                  icon={<ProviderLogo provider={preset.id} />}
                  onClick={() => chooseImgPreset(preset.id)}
                />
              ))}
            </div>
          </div>

          <div className="vad-provider-config-panel">
            <div className="flex items-center gap-2 border-b app-border pb-3">
              <ProviderLogo provider={activeImgPreset.id} compact />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold app-strong">{activeImgPreset.label} 连接配置</p>
                <p className="truncate text-[10px] app-subtle">{activeImgPreset.description}</p>
              </div>
              <ImageIcon className="size-4 app-subtle" />
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
                imgKind === "gemini-image"
                  ? "AIza..."
                  : imgKind === "replicate"
                    ? "r8_..."
                    : "sk-..."
              }
              type={showImageKey ? "text" : "password"}
              mono
              icon={<KeyRound className="size-3.5" />}
              action={
                <button
                  type="button"
                  onClick={() => setShowImageKey((value) => !value)}
                  aria-label={showImageKey ? "隐藏 Image API Key" : "显示 Image API Key"}
                >
                  {showImageKey ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                </button>
              }
            />
            <div>
              <span className="text-xs font-bold app-subtle">推荐模型</span>
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
                  <span className="text-xs font-bold app-subtle">Quality</span>
                  <select
                    value={imgQuality}
                    aria-label="gpt-image 渲染质量"
                    onChange={(e) => setImgQuality(e.target.value as OpenAIImageQuality)}
                    className="mt-1.5 w-full rounded-xl border app-border app-surface px-3 py-2 text-xs font-medium app-strong"
                  >
                    <option value="auto">auto</option>
                    <option value="low">low</option>
                    <option value="medium">medium</option>
                    <option value="high">high</option>
                  </select>
                </div>
                <div>
                  <span className="text-xs font-bold app-subtle">Output Format</span>
                  <select
                    value={imgOutputFormat}
                    aria-label="gpt-image 输出格式"
                    onChange={(e) => setImgOutputFormat(e.target.value as OpenAIImageOutputFormat)}
                    className="mt-1.5 w-full rounded-xl border app-border app-surface px-3 py-2 text-xs font-medium app-strong"
                  >
                    <option value="png">png</option>
                    <option value="jpeg">jpeg</option>
                    <option value="webp">webp</option>
                  </select>
                </div>
                <div>
                  <span className="text-xs font-bold app-subtle">Background</span>
                  <select
                    value={imgBackground}
                    aria-label="gpt-image 背景模式"
                    onChange={(e) => setImgBackground(e.target.value as OpenAIImageBackground)}
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
                : imgKind === "replicate"
                  ? "Replicate Predictions API，支持托管 Flux / SDXL 等模型。"
                  : "OpenAI 兼容 /images/generations → Base64 或 URL。"}
            </p>
          </div>
        </div>
      </div>

      <div>
        <h3 className="mb-2.5 text-[10px] font-bold uppercase tracking-wider app-subtle">
          ③ Content Agent 文案偏好
        </h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <span className="text-xs font-bold app-subtle">语调</span>
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
            <span className="text-xs font-bold app-subtle">语言</span>
            <select
              value={contentLocale}
              onChange={(e) => setContentLocale(e.target.value as ContentLocale)}
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
            {saved ? "已保存" : "保存配置"}
          </button>
        </div>
      </div>

      <p className="mt-4 text-[10px] leading-relaxed app-subtle font-medium">
        API Key 仅本地保存在当前浏览器的 localStorage 中，所有请求转发均直接通过本机的 Next API
        代理完成，100% 绝对不会外传。若想彻底抹除本地存储，请点击「重置为默认」或在浏览器
        Application 存储面板中清空。
      </p>
    </div>
  );

  if (variant === "panel") return form;

  return (
    <div className="app-dialog-overlay">
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        onClick={() => onClose?.()}
        aria-label="关闭模型设置"
      />
      <div
        className="app-dialog vad-provider-dialog relative max-h-[94vh] overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby="provider-dialog-title"
      >
        <div className="vad-provider-header">
          <div className="flex items-start gap-3">
            <div className="vad-provider-heading-icon">
              <Sparkles className="size-4" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 id="provider-dialog-title" className="text-base font-bold app-strong">
                  模型与连接
                </h2>
                <span className="vad-provider-local-badge">
                  <ShieldCheck className="size-3" /> Local-first
                </span>
              </div>
              <p className="mt-1.5 max-w-2xl text-xs leading-relaxed app-subtle">
                分别选择负责推理编排的 LLM 与负责视觉资产的图像模型。支持官方 API、兼容网关和本地
                Ollama。
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onClose?.()}
            className="rounded-xl p-1.5 app-subtle transition hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)]"
            aria-label="关闭"
          >
            <X className="size-4" />
          </button>
        </div>
        {form}
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
    if (img.kind === "replicate") {
      return {
        kind: "replicate" as const,
        presetId: "replicate" as const,
        baseURL: img.baseURL ?? getImagePreset("replicate").defaultBaseURL,
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
    kind: "openai-compatible" as const,
    presetId: "openai-gpt-image" as const,
    baseURL: getImagePreset("openai-gpt-image").defaultBaseURL,
    apiKey: "",
    model: getImagePreset("openai-gpt-image").defaultModel,
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
      presetId =
        LLM_PRESETS.find((p) => p.baseURL === (llm as { baseURL?: string }).baseURL)?.id ??
        "openai";
    }
    return {
      kind,
      presetId,
      baseURL: "baseURL" in llm ? ((llm as { baseURL?: string }).baseURL ?? "") : "",
      apiKey: "apiKey" in llm ? ((llm as { apiKey?: string }).apiKey ?? "") : "",
      model: "model" in llm ? ((llm as { model?: string }).model ?? "") : "",
    };
  }
  return {
    kind: "openai-compatible" as const,
    presetId: "openai",
    baseURL: LLM_PRESETS[0].baseURL,
    apiKey: "",
    model: LLM_PRESETS[0].models[0]?.id ?? "",
  };
}

function ProviderCard({
  active,
  name,
  company,
  description,
  badge,
  icon,
  onClick,
}: {
  active: boolean;
  name: string;
  company: string;
  description: string;
  badge: string;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`vad-provider-card ${active ? "is-active" : ""}`}
    >
      <span className="vad-provider-card-top">
        {icon}
        <span className="vad-provider-card-badge">{badge}</span>
      </span>
      <span className="vad-provider-card-copy">
        <strong>{name}</strong>
        <small>{company}</small>
      </span>
      <span className="vad-provider-card-description">{description}</span>
      <span className="vad-provider-card-check" aria-hidden>
        {active ? <Check className="size-3" /> : null}
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
  icon,
  action,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  mono?: boolean;
  icon?: React.ReactNode;
  action?: React.ReactNode;
}) {
  const inputId = useId();
  return (
    <div className="flex flex-col">
      <label htmlFor={inputId} className="vad-provider-field-label">
        {label}
      </label>
      <div className="vad-provider-input-wrap">
        {icon ? <span className="vad-provider-input-icon">{icon}</span> : null}
        <input
          id={inputId}
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={(mono ? "font-mono " : "") + (icon ? "has-icon" : "")}
        />
        {action ? <span className="vad-provider-input-action">{action}</span> : null}
      </div>
    </div>
  );
}
