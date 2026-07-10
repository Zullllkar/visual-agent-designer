import Link from "next/link";
import { ArrowLeft, ArrowUpRight, Check, Sparkles } from "lucide-react";
import { BriefLauncher } from "@/components/brief-launcher";
import { AppHeader, PageContainer, PageShell } from "@/components/app-chrome";

export default function NewProjectPage() {
  return (
    <PageShell className="vad-create-page">
      <AppHeader />

      <main className="vad-create-main">
        <PageContainer className="vad-create-wrap">
          <Link href="/" className="vad-create-back">
            <ArrowLeft className="size-3.5" />
            返回首页
          </Link>

          <div className="vad-create-grid">
            <section className="vad-create-intro">
              <p className="landing-kicker">04 / NEW PROJECT</p>
              <h1>
                从一个 Brief
                <br />
                开始你的 <em>Canvas.</em>
              </h1>
              <p className="vad-create-lead">
                描述产品想法，VAD 会在本地建立项目并启动 Brief → Direction → Execute → Handoff 流水线。
              </p>

              <div className="vad-create-points">
                <div>
                  <span className="vad-create-point-icon"><Check className="size-3.5" /></span>
                  <p><strong>先澄清，再生成</strong><small>Brief 会成为整个项目的单一事实来源。</small></p>
                </div>
                <div>
                  <span className="vad-create-point-icon"><Check className="size-3.5" /></span>
                  <p><strong>数据留在本地</strong><small>Key 由你管理，项目写入本地浏览器和 .vad 目录。</small></p>
                </div>
                <div>
                  <span className="vad-create-point-icon"><Check className="size-3.5" /></span>
                  <p><strong>随时回到 Canvas</strong><small>生成完成后可以继续对话、迭代素材并导出 Handoff。</small></p>
                </div>
              </div>

              <Link href="/projects" className="vad-create-projects-link">
                查看已有项目
                <ArrowUpRight className="size-3.5" />
              </Link>
            </section>

            <section className="vad-create-form" aria-labelledby="new-project-form-title">
              <div className="vad-create-form-head">
                <div className="vad-create-form-mark"><Sparkles className="size-4" /></div>
                <div>
                  <p id="new-project-form-title">创建项目</p>
                  <span>LOCAL · BYOK · READY</span>
                </div>
              </div>
              <BriefLauncher />
            </section>
          </div>
        </PageContainer>
      </main>
    </PageShell>
  );
}
