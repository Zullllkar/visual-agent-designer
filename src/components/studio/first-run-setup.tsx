"use client";

import { ChevronsUpDown, Eye, EyeOff } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { ProviderLogo, type ProviderLogoId } from "@/components/brand/provider-logo";
import { VadMark } from "@/components/brand/vad-mark";
import { ModelsArt, WelcomeArt, WorkflowArt } from "@/components/studio/first-run-art";
import { useDesktopRuntime } from "@/lib/desktop/use-desktop-runtime";
import { getImagePreset, type ImagePresetId } from "@/lib/providers/image/catalog";
import type { ProviderConfig } from "@/lib/providers/registry";
import { isMockImageConfig, isMockLlmConfig } from "@/lib/providers/validate";
import {
  buildOnboardingImage,
  buildOnboardingLlm,
  FIRST_RUN_OPEN_EVENT,
  type FirstRunOpenDetail,
  type FirstRunStep,
  nextFirstRunStep,
  parseFirstRunStep,
  prevFirstRunStep,
  readFirstRunSkipped,
  readOnboardingDone,
  resolveFirstRunStep,
  shouldShowFirstRunSetup,
  withModelChoices,
  writeFirstRunSkipped,
  writeOnboardingDone,
} from "@/lib/studio/first-run";
import { useProviderStoreHydrated } from "@/lib/use-hydrated";
import { LLM_PRESETS, type LlmPresetId, useProviderStore } from "@/store/provider-store";
import "./first-run-setup.css";

const IMAGE_TILES: Array<{ id: ImagePresetId; label: string }> = [
  { id: "openai-gpt-image", label: "OpenAI" },
  { id: "gemini-image", label: "Gemini" },
  { id: "siliconflow", label: "FLUX" },
  { id: "replicate", label: "Replicate" },
];

const LLM_TILE_LABEL: Record<LlmPresetId, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Gemini",
  deepseek: "DeepSeek",
  qwen: "Qwen",
  openrouter: "OpenRouter",
  ollama: "Ollama",
};

const WORKFLOW_POINTS = [
  {
    title: "简报",
    body: "与 Agent 说清目标、受众和约束，先把要交付的画面定下来。",
  },
  {
    title: "画布",
    body: "在无限画布上生成、挑选和迭代素材，保留你真正要用的方向。",
  },
  {
    title: "交接",
    body: "把图片、prompt 和设计上下文打包，交给编码工具落地。",
  },
] as const;

type OnboardingDraft = {
  llm: { presetId: string; apiKey: string; model: string; baseURL: string };
  image: { presetId: string; apiKey: string; model: string; baseURL: string };
};

export function FirstRunHost() {
  const desktop = useDesktopRuntime();
  const hydrated = useProviderStoreHydrated();
  const config = useProviderStore((state) => state.config);
  const [skipped, setSkipped] = useState(false);
  const [forced, setForced] = useState(false);
  const [onboardingDone, setOnboardingDone] = useState(false);
  const [requestedStep, setRequestedStep] = useState<FirstRunStep | undefined>();

  useEffect(() => {
    setSkipped(readFirstRunSkipped());
    setOnboardingDone(readOnboardingDone());
    function onOpen(event: Event) {
      const detail = (event as CustomEvent<FirstRunOpenDetail>).detail;
      writeFirstRunSkipped(false);
      setSkipped(false);
      setForced(true);
      setRequestedStep(parseFirstRunStep(detail?.step ?? "models"));
    }
    window.addEventListener(FIRST_RUN_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(FIRST_RUN_OPEN_EVENT, onOpen);
  }, []);

  const show = shouldShowFirstRunSetup({
    isDesktop: desktop,
    hydrated,
    llmMock: isMockLlmConfig(config),
    imageMock: isMockImageConfig(config),
    skippedThisSession: skipped,
    forced,
  });

  if (!show) return null;

  const initialStep = resolveFirstRunStep({
    forced,
    onboardingDone,
    requestedStep,
  });

  return (
    <FirstRunSetup
      key={`${forced ? "forced" : "auto"}-${initialStep}`}
      initialStep={initialStep}
      onSkip={() => {
        writeFirstRunSkipped(true);
        setSkipped(true);
        setForced(false);
      }}
      onFinish={() => {
        writeOnboardingDone(true);
        writeFirstRunSkipped(true);
        setOnboardingDone(true);
        setSkipped(true);
        setForced(false);
      }}
    />
  );
}

function FirstRunSetup({
  initialStep,
  onSkip,
  onFinish,
}: {
  initialStep: FirstRunStep;
  onSkip: () => void;
  onFinish: () => void;
}) {
  const titleId = useId();
  const config = useProviderStore((state) => state.config);
  const setConfig = useProviderStore((state) => state.setConfig);
  const [step, setStep] = useState<FirstRunStep>(initialStep);
  const [draft, setDraft] = useState<OnboardingDraft>(() => readOnboardingDraft(config));
  const next = nextFirstRunStep(step);
  const prev = prevFirstRunStep(step);
  const index = step === "welcome" ? 1 : step === "workflow" ? 2 : 3;

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onSkip();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onSkip]);

  return (
    <div className="vad-first-run-overlay">
      <div
        className={`vad-first-run${step === "models" ? " is-models" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <aside className="vad-first-run-art" aria-hidden>
          {step === "welcome" ? <WelcomeArt /> : null}
          {step === "workflow" ? <WorkflowArt /> : null}
          {step === "models" ? <ModelsArt /> : null}
        </aside>

        <section className="vad-first-run-copy">
          <div className="vad-first-run-top">
            <span className="vad-first-run-count">{index} / 3</span>
            <button type="button" className="vad-first-run-skip" onClick={onSkip}>
              跳过
            </button>
          </div>

          <div className={`vad-first-run-copy-body is-${step}`} key={step}>
            {step === "welcome" ? <WelcomePane titleId={titleId} /> : null}
            {step === "workflow" ? <WorkflowPane titleId={titleId} /> : null}
            {step === "models" ? (
              <ModelsPane titleId={titleId} draft={draft} onChange={setDraft} />
            ) : null}
          </div>

          <footer className="vad-first-run-foot">
            {prev ? (
              <button type="button" className="vad-first-run-back" onClick={() => setStep(prev)}>
                返回
              </button>
            ) : (
              <span />
            )}
            {next ? (
              <button
                type="button"
                className={`vad-first-run-continue${step === "welcome" ? "" : " is-ink"}`}
                onClick={() => setStep(next)}
              >
                继续
              </button>
            ) : (
              <button
                type="button"
                className="vad-first-run-continue is-ink"
                onClick={() => {
                  setConfig({
                    ...config,
                    llm: buildOnboardingLlm(draft.llm),
                    image: buildOnboardingImage(draft.image),
                  });
                  onFinish();
                }}
              >
                打开工作台
              </button>
            )}
          </footer>
        </section>
      </div>
    </div>
  );
}

function WelcomePane({ titleId }: { titleId: string }) {
  return (
    <>
      <VadMark size={36} className="vad-first-run-mark" />
      <h1 id={titleId}>欢迎使用 Vibeboard</h1>
      <p>在无限画布上生成视觉素材，再把图片、prompt 和设计上下文打包交给编码工具。</p>
    </>
  );
}

function WorkflowPane({ titleId }: { titleId: string }) {
  return (
    <>
      <h1 id={titleId}>工作方式</h1>
      <p>一次完整交付只做这三件事。</p>
      <ol className="vad-first-run-points">
        {WORKFLOW_POINTS.map((item) => (
          <li key={item.title}>
            <strong>{item.title}</strong>
            <span>{item.body}</span>
          </li>
        ))}
      </ol>
    </>
  );
}
function ModelsPane({
  titleId,
  draft,
  onChange,
}: {
  titleId: string;
  draft: OnboardingDraft;
  onChange: (draft: OnboardingDraft) => void;
}) {
  const [showLlmKey, setShowLlmKey] = useState(false);
  const [showImageKey, setShowImageKey] = useState(false);
  const llmPreset = LLM_PRESETS.find((item) => item.id === draft.llm.presetId) ?? LLM_PRESETS[0];
  const imagePreset = getImagePreset(draft.image.presetId as ImagePresetId);
  const imageTiles = IMAGE_TILES.some((item) => item.id === draft.image.presetId)
    ? IMAGE_TILES
    : [...IMAGE_TILES, { id: draft.image.presetId as ImagePresetId, label: imagePreset.label }];

  return (
    <>
      <h1 id={titleId}>连接模型</h1>
      <p>Key 只写在这台电脑。</p>
      <div className="vad-first-run-form">
        <fieldset>
          <legend>对话</legend>
          <div className="vad-first-run-tiles">
            {LLM_PRESETS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={item.id === draft.llm.presetId ? "is-on" : ""}
                onClick={() =>
                  onChange({
                    ...draft,
                    llm: {
                      presetId: item.id,
                      apiKey: draft.llm.apiKey,
                      model: item.models[0]?.id ?? "",
                      baseURL: item.baseURL,
                    },
                  })
                }
              >
                <ProviderLogo provider={item.id} compact />
                <span>{LLM_TILE_LABEL[item.id]}</span>
              </button>
            ))}
          </div>
          <FieldRow
            label="Base URL"
            value={draft.llm.baseURL}
            placeholder={llmPreset.baseURL}
            mono
            onChange={(baseURL) => onChange({ ...draft, llm: { ...draft.llm, baseURL } })}
          />
          <FieldRow
            label="API Key"
            value={draft.llm.apiKey}
            placeholder={llmPreset.apiKeyHint}
            secret
            shown={showLlmKey}
            onShownChange={setShowLlmKey}
            onChange={(apiKey) => onChange({ ...draft, llm: { ...draft.llm, apiKey } })}
          />
          <ModelIdField
            label="模型"
            value={draft.llm.model}
            placeholder={llmPreset.modelHint}
            options={withModelChoices(llmPreset.models, draft.llm.model)}
            onChange={(model) => onChange({ ...draft, llm: { ...draft.llm, model } })}
          />
        </fieldset>

        <fieldset>
          <legend>生图</legend>
          <div className="vad-first-run-tiles">
            {imageTiles.map((tile) => (
              <button
                key={tile.id}
                type="button"
                className={tile.id === draft.image.presetId ? "is-on" : ""}
                onClick={() => {
                  const item = getImagePreset(tile.id);
                  onChange({
                    ...draft,
                    image: {
                      presetId: item.id,
                      apiKey: draft.image.apiKey,
                      model: item.defaultModel,
                      baseURL: item.defaultBaseURL,
                    },
                  });
                }}
              >
                <ProviderLogo provider={tile.id as ProviderLogoId} compact />
                <span>{tile.label}</span>
              </button>
            ))}
          </div>
          <FieldRow
            label="Base URL"
            value={draft.image.baseURL}
            placeholder={imagePreset.baseURLPlaceholder}
            mono
            onChange={(baseURL) => onChange({ ...draft, image: { ...draft.image, baseURL } })}
          />
          <FieldRow
            label="API Key"
            value={draft.image.apiKey}
            placeholder="只保存在本机"
            secret
            shown={showImageKey}
            onShownChange={setShowImageKey}
            onChange={(apiKey) => onChange({ ...draft, image: { ...draft.image, apiKey } })}
          />
          <ModelIdField
            label="模型"
            value={draft.image.model}
            placeholder={imagePreset.modelHint}
            options={withModelChoices(imagePreset.models, draft.image.model)}
            onChange={(model) => onChange({ ...draft, image: { ...draft.image, model } })}
          />
        </fieldset>
      </div>
    </>
  );
}

function ModelIdField({
  label,
  value,
  placeholder,
  options,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  options: Array<{ id: string; note?: string }>;
  onChange: (value: string) => void;
}) {
  const inputId = useId();
  const listed = options.some((item) => item.id === value) ? value : "";
  return (
    <div className="vad-first-run-field">
      <label htmlFor={inputId}>{label}</label>
      <span className="vad-first-run-combo">
        <input
          id={inputId}
          className="is-mono"
          value={value}
          autoComplete="off"
          spellCheck={false}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
        <span className="vad-first-run-combo-pick">
          <select
            aria-label="从目录选择模型"
            value={listed}
            onChange={(event) => {
              if (event.target.value) onChange(event.target.value);
            }}
          >
            <option value="" disabled>
              选择模型
            </option>
            {options.map((item) => (
              <option key={item.id} value={item.id}>
                {item.note ? `${item.id} · ${item.note}` : item.id}
              </option>
            ))}
          </select>
          <ChevronsUpDown className="size-3.5" aria-hidden />
        </span>
      </span>
    </div>
  );
}

function FieldRow({
  label,
  value,
  placeholder,
  mono,
  secret,
  shown,
  onShownChange,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  mono?: boolean;
  secret?: boolean;
  shown?: boolean;
  onShownChange?: (shown: boolean) => void;
  onChange: (value: string) => void;
}) {
  const inputId = useId();
  return (
    <div className="vad-first-run-field">
      <label htmlFor={inputId}>{label}</label>
      {secret ? (
        <span className="vad-first-run-key">
          <input
            id={inputId}
            type={shown ? "text" : "password"}
            value={value}
            autoComplete="off"
            spellCheck={false}
            placeholder={placeholder}
            onChange={(event) => onChange(event.target.value)}
          />
          <button
            type="button"
            aria-label={shown ? "隐藏密钥" : "显示密钥"}
            onClick={() => onShownChange?.(!shown)}
          >
            {shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </span>
      ) : (
        <input
          id={inputId}
          className={mono ? "is-mono" : undefined}
          value={value}
          autoComplete="off"
          spellCheck={false}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </div>
  );
}

function readOnboardingDraft(config: ProviderConfig): OnboardingDraft {
  const llm = config.llm;
  const image = config.image;
  let llmDraft: OnboardingDraft["llm"] = {
    presetId: "openai",
    apiKey: "",
    model: LLM_PRESETS[0].models[0]?.id ?? "",
    baseURL: LLM_PRESETS[0].baseURL,
  };
  if (llm && llm.kind !== "mock") {
    let presetId: LlmPresetId = "openai";
    if (llm.kind === "anthropic") presetId = "anthropic";
    else if (llm.kind === "gemini") presetId = "gemini";
    else if (llm.kind === "deepseek") presetId = "deepseek";
    else {
      presetId = LLM_PRESETS.find((item) => item.baseURL === llm.baseURL)?.id ?? "openai";
    }
    const preset = LLM_PRESETS.find((item) => item.id === presetId) ?? LLM_PRESETS[0];
    llmDraft = {
      presetId,
      apiKey: "apiKey" in llm ? llm.apiKey : "",
      model: "model" in llm ? llm.model : (preset.models[0]?.id ?? ""),
      baseURL: "baseURL" in llm && llm.baseURL ? llm.baseURL : preset.baseURL,
    };
  }

  const gptPreset = getImagePreset("openai-gpt-image");
  let imageDraft: OnboardingDraft["image"] = {
    presetId: "openai-gpt-image",
    apiKey: "",
    model: gptPreset.defaultModel,
    baseURL: gptPreset.defaultBaseURL,
  };
  if (image && image.kind !== "mock") {
    const presetId: ImagePresetId =
      image.kind === "gemini-image"
        ? "gemini-image"
        : image.kind === "siliconflow"
          ? "siliconflow"
          : image.kind === "replicate"
            ? "replicate"
            : "openai-gpt-image";
    const preset = getImagePreset(presetId);
    imageDraft = {
      presetId,
      apiKey: image.apiKey,
      model: image.model,
      baseURL: image.baseURL ?? preset.defaultBaseURL,
    };
  }

  return { llm: llmDraft, image: imageDraft };
}
