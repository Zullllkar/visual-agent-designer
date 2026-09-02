"use client";

import { ArrowRight, ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { VadMark } from "@/components/brand/vad-mark";
import { BriefLauncher } from "@/components/brief-launcher";
import { StudioProjectCard } from "@/components/studio/studio-project-card";
import { latestStudioProjects } from "@/lib/studio/home-projects";
import { importStudioProject } from "@/lib/studio/library";
import { useProjectStoreHydrated } from "@/lib/use-hydrated";
import { useProjectStore } from "@/store/project-store";
import "./studio-library.css";

function focusPrompt() {
  const input = document.getElementById("studio-prompt-input");
  input?.scrollIntoView({ block: "center", behavior: "smooth" });
  if (input instanceof HTMLTextAreaElement) input.focus();
}

export function StudioHomeContent() {
  const router = useRouter();
  const hydrated = useProjectStoreHydrated();
  const projectsDict = useProjectStore((state) => state.projects);
  const [copied, setCopied] = useState(false);
  const projects = useMemo(() => Object.values(projectsDict), [projectsDict]);
  const latestProjects = useMemo(() => latestStudioProjects(projects), [projects]);

  useEffect(() => {
    if (window.location.hash !== "#create") return;
    window.setTimeout(focusPrompt, 80);
  }, []);

  return (
    <div className="studio-inner">
      <div className="studio-hero" id="create">
        <div className="studio-hero-logo">
          <VadMark size={56} />
        </div>
        <p className="studio-kicker">本地优先 · 画布工作台</p>
        <h1>Vibeboard</h1>
        <p>写 Brief，在画布上跑 Agent，把图和上下文交给开发。</p>
      </div>

      <BriefLauncher className="studio-brief" />

      <ol className="studio-steps" aria-label="工作流程">
        <li>
          <em>01</em>
          <strong>写 Brief</strong>
          <span>选目标，描述要画什么</span>
        </li>
        <li>
          <em>02</em>
          <strong>画布生成</strong>
          <span>Agent 在无限画布上出图</span>
        </li>
        <li>
          <em>03</em>
          <strong>导出 Handoff</strong>
          <span>打包 PNG、prompt 和上下文</span>
        </li>
      </ol>

      <section className="studio-home-projects" aria-labelledby="home-projects-title">
        <div className="studio-gallery-head">
          <div>
            <h2 id="home-projects-title">我的项目</h2>
            <p>
              {hydrated
                ? projects.length > 3
                  ? `最近 3 个，共 ${projects.length} 个本机项目`
                  : `${projects.length} 个本机项目`
                : "正在读取…"}
            </p>
          </div>
          <div className="studio-gallery-actions">
            <button
              type="button"
              className="studio-import"
              onClick={() => {
                void importStudioProject().then((project) => {
                  if (project) router.push(`/projects/${project.id}`);
                });
              }}
            >
              导入项目
            </button>
            <Link href="/projects" className="studio-more-link">
              查看更多
              <ArrowRight className="size-3.5" />
            </Link>
          </div>
        </div>

        {!hydrated ? (
          <div className="studio-empty">正在读取本地项目…</div>
        ) : latestProjects.length === 0 ? (
          <div className="studio-empty">
            <VadMark size={36} />
            <p>还没有项目。写完 Brief 会在本机创建项目并打开画布。</p>
            <button type="button" onClick={focusPrompt}>
              开始写 Brief
            </button>
          </div>
        ) : (
          <div className="studio-gallery studio-gallery--home">
            {latestProjects.map((project) => (
              <StudioProjectCard key={project.id} project={project} variant="library" />
            ))}
          </div>
        )}
      </section>

      <div className="studio-oss">
        <code>git clone https://github.com/Zullllkar/vibeboard.git</code>
        <button
          type="button"
          className="studio-copy"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(
                "git clone https://github.com/Zullllkar/vibeboard.git",
              );
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1600);
            } catch {
              setCopied(false);
            }
          }}
        >
          {copied ? "已复制" : "复制"}
        </button>
        <span>Apache-2.0</span>
        <span>数据留在本机</span>
        <a
          href="https://github.com/Zullllkar/vibeboard/issues"
          target="_blank"
          rel="noreferrer"
        >
          Issues <ArrowUpRight className="size-3" />
        </a>
      </div>
    </div>
  );
}
