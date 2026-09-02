import { describe, expect, it } from "vitest";
import { IMAGE_PROVIDER_CATALOG } from "@/lib/providers/image/catalog";
import { LLM_PRESETS } from "@/store/provider-store";
import {
  buildOnboardingImage,
  buildOnboardingLlm,
  firstRunOpenPayload,
  nextFirstRunStep,
  parseFirstRunStep,
  prevFirstRunStep,
  resolveFirstRunStep,
  shouldShowFirstRunSetup,
  withModelChoices,
} from "./first-run";

describe("shouldShowFirstRunSetup", () => {
  const base = {
    isDesktop: true,
    hydrated: true,
    llmMock: true,
    imageMock: true,
    skippedThisSession: false,
    forced: false,
  };

  it("shows on desktop when models are still mock", () => {
    expect(shouldShowFirstRunSetup(base)).toBe(true);
  });

  it("hides in the browser debug entry", () => {
    expect(shouldShowFirstRunSetup({ ...base, isDesktop: false })).toBe(false);
  });

  it("waits until provider store has hydrated", () => {
    expect(shouldShowFirstRunSetup({ ...base, hydrated: false })).toBe(false);
  });

  it("hides after the user postpones this session", () => {
    expect(shouldShowFirstRunSetup({ ...base, skippedThisSession: true })).toBe(false);
  });

  it("reopens from the status bar even after postpone, while still mock", () => {
    expect(
      shouldShowFirstRunSetup({
        ...base,
        skippedThisSession: true,
        forced: true,
      }),
    ).toBe(true);
  });

  it("replays from settings even after both providers are real", () => {
    expect(
      shouldShowFirstRunSetup({
        ...base,
        llmMock: false,
        imageMock: false,
        forced: true,
      }),
    ).toBe(true);
  });

  it("hides once both providers are real and not forced", () => {
    expect(
      shouldShowFirstRunSetup({
        ...base,
        llmMock: false,
        imageMock: false,
        forced: false,
      }),
    ).toBe(false);
  });
});

describe("first-run steps", () => {
  it("parses known steps and falls back to welcome", () => {
    expect(parseFirstRunStep("welcome")).toBe("welcome");
    expect(parseFirstRunStep("workflow")).toBe("workflow");
    expect(parseFirstRunStep("models")).toBe("models");
    expect(parseFirstRunStep("nope")).toBe("welcome");
  });

  it("walks welcome → workflow → models", () => {
    expect(nextFirstRunStep("welcome")).toBe("workflow");
    expect(nextFirstRunStep("workflow")).toBe("models");
    expect(nextFirstRunStep("models")).toBe(null);
    expect(prevFirstRunStep("models")).toBe("workflow");
    expect(prevFirstRunStep("workflow")).toBe("welcome");
    expect(prevFirstRunStep("welcome")).toBe(null);
  });

  it("starts at welcome the first time, models after onboarding is done", () => {
    expect(resolveFirstRunStep({ forced: false, onboardingDone: false })).toBe("welcome");
    expect(resolveFirstRunStep({ forced: false, onboardingDone: true })).toBe("models");
  });

  it("honors a forced step from settings or the status bar", () => {
    expect(
      resolveFirstRunStep({
        forced: true,
        onboardingDone: true,
        requestedStep: "welcome",
      }),
    ).toBe("welcome");
    expect(
      resolveFirstRunStep({
        forced: true,
        onboardingDone: false,
        requestedStep: "models",
      }),
    ).toBe("models");
  });
});

describe("firstRunOpenPayload", () => {
  it("defaults to models for the status bar, welcome for settings replay", () => {
    expect(firstRunOpenPayload()).toEqual({ step: "models" });
    expect(firstRunOpenPayload("welcome")).toEqual({ step: "welcome" });
  });
});

describe("buildOnboarding providers", () => {
  it("keeps mock when the key is empty", () => {
    expect(
      buildOnboardingLlm({
        presetId: "openai",
        apiKey: "  ",
        model: "gpt-5.2",
        baseURL: "https://api.openai.com/v1",
      }),
    ).toEqual({ kind: "mock" });
    expect(
      buildOnboardingImage({
        presetId: "openai-gpt-image",
        apiKey: "",
        model: "gpt-image-2",
        baseURL: "https://api.openai.com/v1",
      }),
    ).toEqual({ kind: "mock" });
  });

  it("maps LLM presets to provider kinds", () => {
    expect(
      buildOnboardingLlm({
        presetId: "anthropic",
        apiKey: "sk-ant",
        model: "claude-sonnet-4-6",
        baseURL: "https://api.anthropic.com",
      }),
    ).toEqual({
      kind: "anthropic",
      apiKey: "sk-ant",
      model: "claude-sonnet-4-6",
      baseURL: "https://api.anthropic.com",
    });
    expect(
      buildOnboardingLlm({
        presetId: "openai",
        apiKey: "sk-1",
        model: "gpt-5.2",
        baseURL: "https://api.openai.com/v1",
      }),
    ).toEqual({
      kind: "openai-compatible",
      apiKey: "sk-1",
      model: "gpt-5.2",
      baseURL: "https://api.openai.com/v1",
    });
  });

  it("maps image presets to provider kinds", () => {
    expect(
      buildOnboardingImage({
        presetId: "gemini-image",
        apiKey: "AIza",
        model: "gemini-3.1-flash-image",
        baseURL: "https://generativelanguage.googleapis.com",
      }),
    ).toEqual({
      kind: "gemini-image",
      apiKey: "AIza",
      model: "gemini-3.1-flash-image",
      baseURL: "https://generativelanguage.googleapis.com",
    });
  });
});

describe("withModelChoices", () => {
  it("keeps catalog models and appends a custom id", () => {
    const catalog = [{ id: "gpt-5.6-sol" }, { id: "gpt-5.6-terra" }];
    expect(withModelChoices(catalog, "gpt-5.6-sol").map((item) => item.id)).toEqual([
      "gpt-5.6-sol",
      "gpt-5.6-terra",
    ]);
    expect(withModelChoices(catalog, "my-proxy-model").map((item) => item.id)).toEqual([
      "gpt-5.6-sol",
      "gpt-5.6-terra",
      "my-proxy-model",
    ]);
  });
});

describe("latest model catalogs", () => {
  function idsOf(presetId: string) {
    const llm = LLM_PRESETS.find((item) => item.id === presetId);
    return llm?.models.map((item) => item.id) ?? [];
  }

  function imageIds(presetId: string) {
    return (
      IMAGE_PROVIDER_CATALOG.find((item) => item.id === presetId)?.models.map((item) => item.id) ??
      []
    );
  }

  it("lists current OpenAI, Claude and Gemini chat models", () => {
    expect(idsOf("openai")).toEqual(
      expect.arrayContaining(["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-4o-mini"]),
    );
    expect(idsOf("anthropic")).toEqual(
      expect.arrayContaining(["claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5"]),
    );
    expect(idsOf("gemini")).toEqual(
      expect.arrayContaining(["gemini-3.6-flash", "gemini-3.5-flash", "gemini-3.1-pro-preview"]),
    );
  });

  it("lists current image models", () => {
    expect(imageIds("openai-gpt-image")).toEqual(
      expect.arrayContaining(["gpt-image-2", "gpt-image-1.5"]),
    );
    expect(imageIds("gemini-image")).toEqual(
      expect.arrayContaining([
        "gemini-3.1-flash-image",
        "gemini-3-pro-image",
        "gemini-3.1-flash-lite-image",
      ]),
    );
  });
});
