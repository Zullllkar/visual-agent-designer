"use client";

import {
  Cpu,
  HardDrive,
  Info,
  Keyboard,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { type ReactNode, useEffect, useId, useState } from "react";
import { DaemonStatusHint } from "@/components/daemon-status-hint";
import { ProviderSettingsDialog } from "@/components/provider-settings-dialog";
import { useDesktopRuntime } from "@/lib/desktop/use-desktop-runtime";
import {
  type LocalePreference,
  type ThemePreference,
  usePreferences,
} from "@/lib/preferences";
import { STUDIO_SHORTCUTS } from "@/lib/studio/commands";
import { openFirstRunSetup } from "@/lib/studio/first-run";
import { useReduceMotion } from "@/lib/studio/motion";
import { useStudioRail } from "@/lib/studio/rail";
import {
  type StartupPreference,
  readStartupPreference,
  writeStartupPreference,
} from "@/lib/studio/startup";
import type { VadDesktopInfo } from "@/types/vad-desktop";
import "./settings-dialog.css";

export type SettingsSection =
  | "general"
  | "models"
  | "storage"
  | "shortcuts"
  | "about";

const NAV: Array<{
  id: SettingsSection;
  label: string;
  icon: typeof SlidersHorizontal;
}> = [
  { id: "general", label: "通用", icon: SlidersHorizontal },
  { id: "models", label: "模型", icon: Cpu },
  { id: "storage", label: "存储", icon: HardDrive },
  { id: "shortcuts", label: "快捷键", icon: Keyboard },
  { id: "about", label: "关于", icon: Info },
];

const TITLES: Record<SettingsSection, string> = {
  general: "通用",
  models: "模型",
  storage: "存储",
  shortcuts: "快捷键",
  about: "关于",
};

export function SettingsDialog({
  onClose,
  initialSection = "general",
}: {
  onClose: () => void;
  initialSection?: SettingsSection;
}) {
  const [section, setSection] = useState<SettingsSection>(initialSection);
  const titleId = useId();

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="vad-settings-overlay">
      <button
        type="button"
        className="vad-settings-backdrop"
        aria-label="关闭设置"
        onClick={onClose}
      />
      <div
        className="vad-settings"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <nav className="vad-settings-nav" aria-label="设置分类">
          {NAV.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                className={
                  "vad-settings-nav-item" + (section === item.id ? " is-active" : "")
                }
                onClick={() => setSection(item.id)}
              >
                <Icon className="size-4" />
                {item.label}
              </button>
            );
          })}
        </nav>

        <section className="vad-settings-pane">
          <header className="vad-settings-head">
            <h2 id={titleId}>{TITLES[section]}</h2>
            <button
              type="button"
              className="vad-settings-close"
              aria-label="关闭"
              onClick={onClose}
            >
              <X className="size-4" />
            </button>
          </header>
          <div className="vad-settings-body">
            {section === "general" ? <GeneralPane onClose={onClose} /> : null}
            {section === "models" ? (
              <div className="vad-settings-models">
                <ProviderSettingsDialog variant="panel" />
              </div>
            ) : null}
            {section === "storage" ? <StoragePane /> : null}
            {section === "shortcuts" ? <ShortcutsPane /> : null}
            {section === "about" ? <AboutPane /> : null}
          </div>
        </section>
      </div>
    </div>
  );
}

function GeneralPane({ onClose }: { onClose: () => void }) {
  const desktop = useDesktopRuntime();
  const { locale, theme, setLocale, setTheme } = usePreferences();
  const [rail, setRail] = useStudioRail();
  const [reduceMotion, setReduceMotion] = useReduceMotion();
  const [startup, setStartup] = useState<StartupPreference>("home");

  useEffect(() => {
    setStartup(readStartupPreference());
  }, []);

  return (
    <>
      <SettingsRow title="语言" description="选择应用的显示语言。">
        <select
          className="vad-settings-select"
          value={locale}
          onChange={(event) => setLocale(event.target.value as LocalePreference)}
        >
          <option value="zh">中文</option>
          <option value="en">English</option>
        </select>
      </SettingsRow>
      <SettingsRow title="主题" description="浅色或深色，下次启动沿用这次的选择。">
        <select
          className="vad-settings-select"
          value={theme === "dark" ? "dark" : "light"}
          onChange={(event) => setTheme(event.target.value as ThemePreference)}
        >
          <option value="light">浅色</option>
          <option value="dark">深色</option>
        </select>
      </SettingsRow>
      <SettingsRow title="启动时" description="下次打开应用时进入工作室，或回到上次的画布。">
        <select
          className="vad-settings-select"
          value={startup}
          onChange={(event) => {
            const next = event.target.value === "last" ? "last" : "home";
            setStartup(next);
            writeStartupPreference(next);
          }}
        >
          <option value="home">工作室首页</option>
          <option value="last">上次打开的项目</option>
        </select>
      </SettingsRow>
      <div className="vad-settings-group">工作台</div>
      <SettingsRow
        title="收起侧栏"
        description="首页左侧改成窄轨，把空间留给 Brief 和作品。"
      >
        <Toggle pressed={rail} onPressedChange={setRail} label="收起侧栏" />
      </SettingsRow>
      {desktop ? (
        <SettingsRow
          title="首次向导"
          description="重新查看欢迎页、工作方式和模型配置。"
        >
          <button
            type="button"
            className="vad-settings-btn"
            onClick={() => {
              onClose();
              openFirstRunSetup("welcome");
            }}
          >
            打开向导
          </button>
        </SettingsRow>
      ) : null}
      <SettingsRow
        title="减少动态效果"
        description="关闭卡片抬起和侧栏过渡，界面会更安静。"
      >
        <Toggle
          pressed={reduceMotion}
          onPressedChange={setReduceMotion}
          label="减少动态效果"
        />
      </SettingsRow>
    </>
  );
}

function StoragePane() {
  const desktop = useDesktopRuntime();
  const [info, setInfo] = useState<VadDesktopInfo | null>(null);

  useEffect(() => {
    if (!desktop) return;
    let cancelled = false;
    void window.vadDesktop?.getInfo().then((value) => {
      if (!cancelled) setInfo(value);
    });
    return () => {
      cancelled = true;
    };
  }, [desktop]);

  return (
    <>
      <SettingsRow
        title="项目目录"
        description={
          desktop
            ? "桌面端项目写在本机用户目录，不上传。"
            : "浏览器调试时项目写在仓库 .vad/projects/ 与本地存储。"
        }
      >
        {desktop ? (
          <button
            type="button"
            className="vad-settings-btn"
            onClick={() => window.vadDesktop?.openPath("vadRoot")}
          >
            打开目录
          </button>
        ) : (
          <span className="app-subtle text-xs">.vad/projects/</span>
        )}
      </SettingsRow>
      {info?.vadRoot ? <p className="vad-settings-path">{info.vadRoot}</p> : null}
      {desktop ? (
        <SettingsRow title="日志" description="桌面端运行日志，排查启动和连不上本地服务时用。">
          <button
            type="button"
            className="vad-settings-btn"
            onClick={() => window.vadDesktop?.openPath("logs")}
          >
            打开日志
          </button>
        </SettingsRow>
      ) : null}
      {info?.checkpoints ? (
        <>
          <SettingsRow
            title="检查点"
            description="长任务中间状态写在本机检查点目录。"
          >
            <span className="app-subtle text-xs">本机</span>
          </SettingsRow>
          <p className="vad-settings-path">{info.checkpoints}</p>
        </>
      ) : null}
      <div className="vad-settings-group">落盘</div>
      <DaemonStatusHint />
    </>
  );
}

function ShortcutsPane() {
  return (
    <>
      {STUDIO_SHORTCUTS.map((row) => (
        <div className="vad-settings-row" key={row.keys}>
          <div className="vad-settings-copy">
            <strong>{row.action}</strong>
          </div>
          <kbd className="vad-settings-kbd">{row.keys}</kbd>
        </div>
      ))}
    </>
  );
}

function AboutPane() {
  const desktop = useDesktopRuntime();
  const [info, setInfo] = useState<VadDesktopInfo | null>(null);

  useEffect(() => {
    if (!desktop) return;
    let cancelled = false;
    void window.vadDesktop?.getInfo().then((value) => {
      if (!cancelled) setInfo(value);
    });
    return () => {
      cancelled = true;
    };
  }, [desktop]);

  return (
    <>
      <SettingsRow
        title="Vibeboard"
        description="本地优先的画布工作台。模型 Key 留在本机。"
      >
        <span className="app-subtle text-xs">
          {info?.version ? `v${info.version}` : "v0.1.0"}
        </span>
      </SettingsRow>
      <SettingsRow title="许可证" description="源代码按 Apache-2.0 发布。">
        <span className="app-subtle text-xs">Apache-2.0</span>
      </SettingsRow>
      <SettingsRow title="运行环境" description={desktop ? "Electron 桌面壳，数据在用户目录。" : "浏览器调试，数据在仓库 .vad/ 与本地存储。"}>
        <span className="app-subtle text-xs">{desktop ? "桌面端" : "浏览器"}</span>
      </SettingsRow>
      <SettingsRow title="仓库" description="问题与贡献走 GitHub。">
        <a
          className="vad-settings-btn"
          href="https://github.com/Zullllkar/vibeboard"
          target="_blank"
          rel="noreferrer"
        >
          打开 GitHub
        </a>
      </SettingsRow>
      <SettingsRow title="技术栈" description="Next.js、tldraw、Zustand。本地优先，不上传 Key。">
        <span className="app-subtle text-xs">OSS</span>
      </SettingsRow>
    </>
  );
}

function SettingsRow({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="vad-settings-row">
      <div className="vad-settings-copy">
        <strong>{title}</strong>
        <p>{description}</p>
      </div>
      {children}
    </div>
  );
}

function Toggle({
  pressed,
  onPressedChange,
  label,
}: {
  pressed: boolean;
  onPressedChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={pressed}
      aria-label={label}
      className={"vad-settings-switch" + (pressed ? " is-on" : "")}
      onClick={() => onPressedChange(!pressed)}
    />
  );
}
