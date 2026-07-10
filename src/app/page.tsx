"use client";

/**
 * 首页：开源工具站质感 Launchpad
 * --------------------------------------------------------------
 * 大气氛围 + 品牌标题 + 精致输入 + 安静信任信号 + 最近项目
 * @author：wangjunhua
 */

import { useState } from "react";
import Link from "next/link";
import {
  AppHeader,
  PageShell,
} from "@/components/app-chrome";

export default function Home() {
  return (
    <PageShell className="vad-home">
      <AppHeader />

      <section className="landing-hero landing-wrap" id="top">
        <div className="landing-hero-copy">
          <p className="landing-kicker">LOCAL-FIRST · APACHE-2.0 · OPEN SOURCE</p>
          <h1 className="landing-display">画布上编排 <em>Agent</em>，导出可交付 Handoff<span>.</span></h1>
          <p className="landing-lead">本地跑多 Agent 流水线，把 Brief、方向、素材与 token 打成包，交给 Cursor / Claude Code / Codex。</p>
          <div className="landing-hero-actions">
            <Link className="landing-btn landing-btn-primary" href="/projects/new">新建项目</Link>
            <a className="landing-btn landing-btn-ghost" href="https://github.com/Zullllkar/visual-agent-designer" target="_blank" rel="noreferrer">GitHub</a>
          </div>
          <div className="landing-install"><code>git clone https://github.com/Zullllkar/visual-agent-designer.git</code><code>pnpm install && pnpm dev</code></div>
        </div>
        <aside className="landing-pipeline-card" aria-label="八阶段流水线摘要">
          {[
            ["01", "Brief / Architect", "用户、目的、交付物"],
            ["03", "Direction / Layout", "视觉方向与画板构图"],
            ["07", "Content → Execute", "文案、生图、落盘"],
            ["08", "Critic / Handoff", "自检后导出开发包"],
          ].map(([number, title, detail], index) => (
            <div className={`landing-pipeline-step ${index === 1 ? "is-hot" : ""}`} key={number}>
              <span>{number}</span><div><strong>{title}</strong><small>{detail}</small></div>
            </div>
          ))}
          <p>完整八节点可在 Canvas 拖拽连线。右侧对话推进下一步。</p>
        </aside>
      </section>

      <LandingContent />

      <LandingFooter />
    </PageShell>
  );
}

function LandingContent() {
  return (
    <div id="main" className="landing-main">
      <section className="landing-wrap" id="product">
        <div className="landing-facts">
          <span><strong>本地优先</strong> · 数据在 <code>.vad/projects/</code></span>
          <span><strong>BYOK</strong> · Key 不上传</span>
          <span><strong>Apache-2.0</strong></span>
          <span><strong>tldraw 5</strong> 无限画布</span>
        </div>
        <div className="landing-split">
          <article><h2>可视化 <em>Agent</em> 编排</h2><p>ChatCanvas 工作台在无限画布上跑流水线，不是网页结构 mock。节点可拖、可连，状态写在节点上。</p><p>右侧对话推进下一步；回退到任意阶段重跑，过程可追踪。</p></article>
          <article><h2>设计系统随 <em>Handoff</em> 走</h2><p>色板、字体、圆角与组件约定写进导出包。coding agent 拿到可落地的上下文，不是一张截图。</p><p>PNG、prompts、tokens、Brief 一并打包，交给 Cursor / Claude Code / Codex 继续写。</p></article>
        </div>
      </section>
      <section className="landing-stages landing-wrap" id="pipeline">
        <h2>八阶段，可回退</h2><p className="landing-section-intro">从产品想法到可交付视觉素材，再到 coding agent 可执行的开发包。</p>
        <ul><li><span>01-02</span><strong>Brief · Architect</strong><small>想法澄清与结构</small></li><li><span>03-04</span><strong>Direction · Layout</strong><small>视觉方向与构图</small></li><li><span>05-07</span><strong>Content → Execute</strong><small>文案、计划、生图</small></li><li><span>08</span><strong>Critic · Handoff</strong><small>自检与导出</small></li></ul>
        <p className="landing-stack-line">Next.js 16 · React 19 · tldraw 5 · Zustand · Tailwind 4</p>
      </section>
      <section className="landing-oss landing-wrap" id="open-source">
        <h2>在 <em>GitHub</em> 上使用与贡献</h2><p className="landing-section-intro">克隆后运行 <code>pnpm install && pnpm dev</code> 即可打开工作台。Issue 与 PR 欢迎。</p>
        <div className="landing-oss-grid">
          <div className="landing-oss-block"><h3>克隆仓库</h3><p>可选 Daemon 处理落盘，避免热重载与长任务争抢。</p><CloneCommand /><div className="landing-oss-meta"><span><strong>License</strong> Apache-2.0</span><span><strong>Stack</strong> Next.js 16 · tldraw 5</span></div></div>
          <div className="landing-oss-block"><h3>仓库入口</h3><ul className="landing-oss-links"><RepoLink href="https://github.com/Zullllkar/visual-agent-designer" label="Repository" detail="源码" /><RepoLink href="https://github.com/Zullllkar/visual-agent-designer/issues" label="Issues" detail="缺陷 / 需求" /><RepoLink href="https://github.com/Zullllkar/visual-agent-designer/pulls" label="Pull requests" detail="贡献" /><RepoLink href="https://github.com/Zullllkar/visual-agent-designer/blob/main/LICENSE" label="LICENSE" detail="Apache-2.0" /><RepoLink href="https://github.com/Zullllkar/visual-agent-designer#readme" label="README" detail="快速开始" /></ul></div>
        </div>
        <div className="landing-end"><p>打开 <em>Canvas</em>，从 Brief 开始</p><a className="landing-btn landing-btn-ghost" href="https://github.com/Zullllkar/visual-agent-designer" target="_blank" rel="noreferrer">Star on GitHub</a><Link className="landing-btn landing-btn-primary" href="/projects">进入工作台</Link></div>
      </section>
    </div>
  );
}

function RepoLink({ href, label, detail }: { href: string; label: string; detail: string }) {
  return <li><a href={href} target="_blank" rel="noreferrer"><span>{label}</span><small>{detail}</small></a></li>;
}

function CloneCommand() {
  const [copied, setCopied] = useState(false);
  const command = "git clone https://github.com/Zullllkar/visual-agent-designer.git";
  async function copy() {
    try { await navigator.clipboard.writeText(command); setCopied(true); window.setTimeout(() => setCopied(false), 1800); } catch { setCopied(false); }
  }
  return <div className="landing-clone"><code>{command}</code><button type="button" onClick={copy}>{copied ? "已复制" : "复制"}</button></div>;
}

function LandingFooter() {
  return <footer className="landing-footer landing-wrap"><span>Visual Agent Designer</span><a href="#license">Apache-2.0</a><a href="https://github.com/Zullllkar/visual-agent-designer" target="_blank" rel="noreferrer">GitHub</a><a href="https://github.com/Zullllkar/visual-agent-designer/issues" target="_blank" rel="noreferrer">Issues</a><Link href="/projects">Canvas</Link><span className="landing-footer-spacer">本地优先 · 开源</span></footer>;
}
