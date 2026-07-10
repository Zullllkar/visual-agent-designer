"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from "react";

export type ThemePreference = "light" | "dark";
export type LocalePreference = "zh" | "en";

interface PreferencesSnapshot {
  theme: ThemePreference;
  locale: LocalePreference;
}

const STORAGE_KEY = "vad.preferences.v1";
const DEFAULT_PREFERENCES: PreferencesSnapshot = {
  theme: "light",
  locale: "zh",
};

const dictionaries = {
  zh: {
    "app.name": "Visual Agent Designer",
    "app.badge": "alpha",
    "nav.projects": "项目",
    "nav.github": "GitHub",
    "nav.backHome": "返回首页",
    "nav.backProjects": "返回项目列表",
    "theme.light": "亮色",
    "theme.dark": "深色",
    "theme.toLight": "切换到亮色模式",
    "theme.toDark": "切换到深色模式",
    "locale.zh": "中文",
    "locale.en": "English",
    "home.kicker": "开源 · 本地优先 · API Key 留在本机",
    "home.titleLine1": "把产品想法，",
    "home.titleLine2": "变成可交付的视觉素材。",
    "home.description":
      "描述你的产品，VAD 在本地无限画布上跑 Brief → 视觉方向 → 生图。输出高保真图片素材与设计上下文，交给 Cursor / Claude Code 落地——不是网页结构代码框。",
    "home.viewProjects": "打开项目列表",
    "home.footer": "本地优先开源设计工作台",
    "home.powered": "Next.js · tldraw · Tailwind",
    "home.trust.local": "本地优先",
    "home.trust.providers": "可插拔 LLM / 生图",
    "home.trust.keys": "密钥不上传",
    "home.trust.open": "开源可自托管",
    "home.flowTitle": "一条可追踪的交付链路",
    "home.flow.brief.label": "Brief",
    "home.flow.brief.detail":
      "把想法收成可编辑的项目 Brief，作为后续 Agent 与生图的单一事实来源。",
    "home.flow.canvas.label": "画布生图",
    "home.flow.canvas.detail":
      "在无限画布上生成、迭代高保真视觉素材，全部可回看、可重跑、可下载。",
    "home.flow.handoff.label": "导出上下文",
    "home.flow.handoff.detail":
      "打包视觉资产、prompt 与设计上下文，交给 Cursor / Claude Code / Codex 继续落地。",
    "home.examplesTitle": "试试这些想法",
    "home.example.fitness": "健身 App 首页，含训练计划与今日数据",
    "home.example.saas": "SaaS 数据看板，深色专业风",
    "home.example.shop": "电商小程序首页，主打限时闪购",
    "home.recent": "最近项目",
    "home.viewAll": "查看全部",
    "brief.placeholder":
      "例如：做一个面向独立开发者的 AI 灵感记录 App，深色极简，强调记录速度与项目计划。",
    "brief.providerTitle": "配置模型 Provider",
    "brief.mock": "Mock（未配置真实模型）",
    "brief.realModel": "真实模型",
    "brief.shortcut": "⌘/Ctrl + Enter 提交",
    "brief.generating": "生成中...",
    "brief.submit": "生成素材",
    "brief.error": "出错",
    "projects.title": "项目工作台",
    "projects.description":
      "项目会持久化在本地浏览器数据库和本机 .vad 目录中。你可以继续在画布上生成素材、迭代变体并导出 handoff 交付包。",
    "projects.create": "新建项目",
    "projects.loading": "正在加载项目...",
    "projects.empty": "还没有项目。回到首页输入产品想法即可创建。",
    "projects.pages": "素材",
    "projects.updated": "更新于",
    "projects.open": "打开工作台",
    "ide.loading": "加载本地项目中...",
    "ide.notFound": "找不到项目",
    "ide.notFoundDesc": "当前本地项目数据中没有这个项目。",
    "ide.layers": "Brief",
    "ide.assets": "素材",
    "ide.pages": "素材",
    "ide.searchLayers": "搜索素材...",
    "ide.projectBrief": "项目 Brief",
    "ide.qualityReview": "质量评审",
    "ide.rawIdea": "原始想法",
    "ide.export": "导出",
    "ide.exportPage": "导出素材包",
    "ide.exportProject": "导出项目 JSON",
    "ide.exportHandoff": "导出 Handoff 包",
    "ide.ai": "AI Assistant",
    "ide.aiHello": "你好！👋",
    "ide.aiPrompt": "我可以怎样帮你生成视觉素材？",
    "ide.suggestions": "建议操作",
    "ide.openImages": "打开素材生成面板",
    "ide.inputPlaceholder": "描述要生成或修改的视觉内容...",
  },
  en: {
    "app.name": "Visual Agent Designer",
    "app.badge": "alpha",
    "nav.projects": "Projects",
    "nav.github": "GitHub",
    "nav.backHome": "Back home",
    "nav.backProjects": "Back to projects",
    "theme.light": "Light",
    "theme.dark": "Dark",
    "theme.toLight": "Switch to light mode",
    "theme.toDark": "Switch to dark mode",
    "locale.zh": "中文",
    "locale.en": "English",
    "home.kicker": "Open source · local-first · keys stay on your machine",
    "home.titleLine1": "Turn a product idea",
    "home.titleLine2": "into deliverable visual assets.",
    "home.description":
      "Describe your product. VAD runs Brief → design direction → image generation on a local infinite canvas. You get high-fidelity image assets and design context for Cursor / Claude Code — not webpage structure frames.",
    "home.viewProjects": "Open project list",
    "home.footer": "Local-first open-source design workbench",
    "home.powered": "Next.js · tldraw · Tailwind",
    "home.trust.local": "Local-first",
    "home.trust.providers": "Pluggable LLM / image",
    "home.trust.keys": "Keys never leave",
    "home.trust.open": "Open source",
    "home.flowTitle": "One traceable delivery path",
    "home.flow.brief.label": "Brief",
    "home.flow.brief.detail":
      "Turn an idea into an editable project Brief — the single source of truth for Agent and image generation.",
    "home.flow.canvas.label": "Canvas images",
    "home.flow.canvas.detail":
      "Generate and iterate high-fidelity visual assets on an infinite canvas — reviewable, regenerable, downloadable.",
    "home.examplesTitle": "Try these ideas",
    "home.example.fitness": "Fitness app home with training plan and daily stats",
    "home.example.saas": "SaaS analytics dashboard, dark professional style",
    "home.example.shop": "E-commerce mini-app home with flash sale focus",
    "home.recent": "Recent projects",
    "home.viewAll": "View all",
    "home.flow.handoff.label": "Export context",
    "home.flow.handoff.detail":
      "Package visuals, prompts, and design context for Cursor, Claude Code, or Codex.",
    "brief.placeholder":
      "Example: An AI inspiration notebook for indie makers — dark, minimal, fast capture and project planning.",
    "brief.providerTitle": "Configure model provider",
    "brief.mock": "Mock (no real model configured)",
    "brief.realModel": "Real model",
    "brief.shortcut": "⌘/Ctrl + Enter to submit",
    "brief.generating": "Generating...",
    "brief.submit": "Generate assets",
    "brief.error": "Error",
    "projects.title": "Project workspace",
    "projects.description":
      "Projects are persisted in browser storage and the local .vad directory. Continue generating assets, iterating variants, and exporting handoff packages.",
    "projects.create": "New project",
    "projects.loading": "Loading projects...",
    "projects.empty": "No projects yet. Go back home and describe a product idea to create one.",
    "projects.pages": "assets",
    "projects.updated": "Updated",
    "projects.open": "Open workspace",
    "ide.loading": "Loading local project...",
    "ide.notFound": "Project not found",
    "ide.notFoundDesc": "This project is not available in local project storage.",
    "ide.layers": "Brief",
    "ide.assets": "Assets",
    "ide.pages": "Assets",
    "ide.searchLayers": "Search assets...",
    "ide.projectBrief": "Project Brief",
    "ide.qualityReview": "Quality Review",
    "ide.rawIdea": "Raw Idea",
    "ide.export": "Export",
    "ide.exportPage": "Export assets",
    "ide.exportProject": "Export project JSON",
    "ide.exportHandoff": "Export Handoff package",
    "ide.ai": "AI Assistant",
    "ide.aiHello": "Hello! 👋",
    "ide.aiPrompt": "How can I help you generate visual assets?",
    "ide.suggestions": "Suggested actions",
    "ide.openImages": "Open image workspace",
    "ide.inputPlaceholder": "Describe the visual content to generate or edit...",
  },
} as const;

export type TranslationKey = keyof typeof dictionaries.zh;

let preferences = DEFAULT_PREFERENCES;
const listeners = new Set<() => void>();

const PreferencesContext = createContext<ReturnType<typeof createPreferencesApi> | null>(
  null
);

export function PreferencesProvider({ children }: { children: React.ReactNode }) {
  const snapshot = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot
  );

  useEffect(() => {
    initializePreferences();
  }, []);

  useEffect(() => {
    applyPreferences(snapshot);
  }, [snapshot]);

  const api = useMemo(() => createPreferencesApi(snapshot), [snapshot]);

  return (
    <PreferencesContext.Provider value={api}>
      {children}
    </PreferencesContext.Provider>
  );
}

export function usePreferences() {
  const value = useContext(PreferencesContext);
  if (!value) {
    throw new Error("usePreferences must be used inside PreferencesProvider");
  }
  return value;
}

function createPreferencesApi(snapshot: PreferencesSnapshot) {
  return {
    ...snapshot,
    setTheme,
    toggleTheme: () => setTheme(snapshot.theme === "dark" ? "light" : "dark"),
    setLocale,
    t: (key: TranslationKey) =>
      dictionaries[snapshot.locale][key] ?? dictionaries.zh[key] ?? key,
  };
}

function initializePreferences() {
  if (typeof window === "undefined") return;
  const stored = readStoredPreferences();
  const next: PreferencesSnapshot = {
    theme: stored?.theme ?? "light",
    locale:
      stored?.locale ??
      (window.navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en"),
  };
  updatePreferences(next, false);
}

function setTheme(theme: ThemePreference) {
  updatePreferences({ ...preferences, theme }, true);
}

function setLocale(locale: LocalePreference) {
  updatePreferences({ ...preferences, locale }, true);
}

function updatePreferences(next: PreferencesSnapshot, persist: boolean) {
  preferences = next;
  applyPreferences(next);
  if (persist && typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }
  listeners.forEach((listener) => listener());
}

function applyPreferences(snapshot: PreferencesSnapshot) {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", snapshot.theme === "dark");
  document.documentElement.dataset.theme = snapshot.theme;
  document.documentElement.lang = snapshot.locale === "zh" ? "zh-CN" : "en";
}

function readStoredPreferences(): Partial<PreferencesSnapshot> | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PreferencesSnapshot>;
    return {
      theme: parsed.theme === "dark" || parsed.theme === "light" ? parsed.theme : undefined,
      locale: parsed.locale === "zh" || parsed.locale === "en" ? parsed.locale : undefined,
    };
  } catch {
    return null;
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return preferences;
}

function getServerSnapshot() {
  return DEFAULT_PREFERENCES;
}
