import type { Metadata } from "next";
import "@fontsource-variable/inter";
import "./globals.css";
import { PreferencesProvider } from "@/lib/preferences";

// Inter Variable 通过 @fontsource 自托管（无需连 fonts.gstatic.com）；
// 中文回落到系统字体栈，与 svg-renderer 保持一致。

export const metadata: Metadata = {
  title: "Visual Agent Designer",
  description:
    "本地优先的 AI 产品设计工具：从产品想法到 UI 原型，再到 coding agent 可执行的开发上下文。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <PreferencesProvider>{children}</PreferencesProvider>
      </body>
    </html>
  );
}
