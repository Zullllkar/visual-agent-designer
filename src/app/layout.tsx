import type { Metadata } from "next";
import "@fontsource-variable/inter";
import "./globals.css";
import { DesktopCommands } from "@/components/desktop/desktop-commands";
import { DesktopShell } from "@/components/desktop/desktop-shell";
import { SettingsHost } from "@/components/settings/settings-host";
import { FirstRunHost } from "@/components/studio/first-run-setup";
import { StartupRestore } from "@/components/studio/startup-restore";
import { StudioRouteFrame } from "@/components/studio/studio-route-frame";
import { PersistHydration } from "@/lib/persist-hydration";
import { PreferencesProvider } from "@/lib/preferences";

// Inter Variable 通过 @fontsource 自托管（无需连 fonts.gstatic.com）；
// 中文回落到系统字体栈，与 svg-renderer 保持一致。

export const metadata: Metadata = {
  title: "Vibeboard",
  description:
    "本地优先的 AI 产品设计工具：从产品想法到 UI 原型，再到 coding agent 可执行的开发上下文。",
  icons: {
    icon: "/brand/vibeboard-mark.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="h-full antialiased" suppressHydrationWarning>
      <body
        className="min-h-full flex flex-col bg-background text-foreground"
        suppressHydrationWarning
      >
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var r=document.documentElement,t="light",raw=localStorage.getItem("vad.preferences.v1");if(raw){var p=JSON.parse(raw);if(p.theme==="dark")t="dark";else if(p.theme==="light")t="light"}r.classList.toggle("dark",t==="dark");r.dataset.theme=t;r.classList.add("vad-theme-booting");if(window.vadDesktop&&window.vadDesktop.runtime==="electron")r.classList.add("vad-desktop");if(localStorage.getItem("vad.studio.reduceMotion")==="1")r.classList.add("reduce-motion")}catch(e){}})();`,
          }}
        />
        <PreferencesProvider>
          <PersistHydration />
          <StartupRestore />
          <DesktopCommands />
          <DesktopShell>
            <StudioRouteFrame>{children}</StudioRouteFrame>
          </DesktopShell>
          <SettingsHost />
          <FirstRunHost />
        </PreferencesProvider>
      </body>
    </html>
  );
}
