"use client";

import { ArrowRight, FolderInput } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { BriefLauncher } from "@/components/brief-launcher";
import { VadMark } from "@/components/brand/vad-mark";
import { projectCoverSrc } from "@/lib/project/cover";
import type { ProjectFile } from "@/lib/project/schema";
import { latestStudioProjects } from "@/lib/studio/home-projects";
import { revealHighlighted } from "@/lib/studio/type-line";
import { importStudioProject } from "@/lib/studio/library";
import { getTargetRecipe, parseTargetId } from "@/lib/targets/resolve";
import { useProjectStoreHydrated } from "@/lib/use-hydrated";
import { useProjectStore } from "@/store/project-store";
import "./studio-library.css";

function focusPrompt() {
  const input = document.getElementById("studio-prompt-input");
  input?.scrollIntoView({ block: "center", behavior: "smooth" });
  if (input instanceof HTMLTextAreaElement) input.focus();
}

function greetingFor(hour: number): string {
  if (hour < 5) return "夜深了";
  if (hour < 11) return "早上好";
  if (hour < 13) return "中午好";
  if (hour < 18) return "下午好";
  return "晚上好";
}

function homeBlurb(project: ProjectFile): string {
  const idea = project.rawIdea.trim();
  if (idea) return idea.length > 72 ? `${idea.slice(0, 72)}…` : idea;
  return getTargetRecipe(parseTargetId(project.targetId)).goalSentence;
}

const HOME_TITLE = "把想法变成设计稿";
const HOME_HIGHLIGHT = "想法";

function homeLede(greeting: string): string {
  return `${greeting}。写一句，直接上画布。`;
}

const ONBOARDING_STEPS = [
  { title: "写 Brief", detail: "选目标，描述要画的画面或产品界面。" },
  { title: "画布生成", detail: "Agent 会在画布上生成多种视觉方案。" },
  { title: "导出 Handoff", detail: "打包 PNG、Prompt 和上下文，交给开发工具。" },
];

export function StudioHomeContent() {
  const router = useRouter();
  const hydrated = useProjectStoreHydrated();
  const projectsDict = useProjectStore((state) => state.projects);
  const [greeting, setGreeting] = useState("你好");
  const [titleCount, setTitleCount] = useState(0);
  const [ledeCount, setLedeCount] = useState(0);
  const [ledeDone, setLedeDone] = useState(false);
  const projects = useMemo(() => Object.values(projectsDict), [projectsDict]);
  const latestProjects = useMemo(() => latestStudioProjects(projects), [projects]);
  const lede = homeLede(greeting);
  const titleShown = revealHighlighted(HOME_TITLE, HOME_HIGHLIGHT, titleCount);
  const titleCaret = titleCount < HOME_TITLE.length;
  const ledeCaret = !titleCaret && !ledeDone;

  useEffect(() => {
    const nextGreeting = greetingFor(new Date().getHours());
    const fullLede = homeLede(nextGreeting);
    setGreeting(nextGreeting);
    if (window.location.hash === "#create") window.setTimeout(focusPrompt, 80);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setTitleCount(HOME_TITLE.length);
      setLedeCount(fullLede.length);
      setLedeDone(true);
    } else {
      let titleN = 0;
      let ledeN = 0;
      let phase: "title" | "gap" | "lede" = "title";
      const timer = window.setInterval(() => {
        if (phase === "title") {
          titleN += 1;
          setTitleCount(titleN);
          if (titleN >= HOME_TITLE.length) phase = "gap";
          return;
        }
        if (phase === "gap") {
          phase = "lede";
          return;
        }
        ledeN += 1;
        setLedeCount(ledeN);
        if (ledeN >= fullLede.length) {
          setLedeDone(true);
          window.clearInterval(timer);
        }
      }, 48);
      return () => window.clearInterval(timer);
    }
  }, []);

  function importProject() {
    void importStudioProject().then((project) => {
      if (project) router.push(`/projects/${project.id}`);
    });
  }

  return (
    <div className="studio-inner studio-inner--home">
      <header className="studio-hero" id="create">
        <h1 aria-label={HOME_TITLE}>
          {titleShown.before}
          {titleShown.highlight ? <span>{titleShown.highlight}</span> : null}
          {titleShown.after}
          {titleCaret ? <i className="studio-caret" /> : null}
        </h1>
        <p className="studio-lede">
          {lede.slice(0, ledeCount)}
          {ledeCaret ? <i className="studio-caret" /> : null}
        </p>
      </header>

      <BriefLauncher />

      <section className="studio-section" aria-labelledby="home-projects-title">
        <div className="studio-section-head">
          <h2 id="home-projects-title">
            最近项目
            {hydrated && projects.length > 0 ? (
              <span className="studio-section-count">{projects.length}</span>
            ) : null}
          </h2>
          <div className="studio-section-actions">
            <button type="button" className="studio-btn studio-btn--ghost" onClick={importProject}>
              <FolderInput className="size-3.5" aria-hidden />
              导入项目
            </button>
            <Link href="/projects" className="studio-btn studio-btn--ghost">
              全部项目
              <ArrowRight className="size-3.5" aria-hidden />
            </Link>
          </div>
        </div>

        {!hydrated ? (
          <ul className="studio-home-list" aria-busy="true">
            {[0, 1, 2, 3].map((slot) => (
              <li key={slot} className="studio-home-row studio-home-row--skeleton" />
            ))}
          </ul>
        ) : latestProjects.length === 0 ? (
          <div className="studio-onboard">
            <ol className="studio-onboard-steps">
              {ONBOARDING_STEPS.map((step, index) => (
                <li key={step.title}>
                  <em>{String(index + 1).padStart(2, "0")}</em>
                  <strong>{step.title}</strong>
                  <span>{step.detail}</span>
                </li>
              ))}
            </ol>
            <div className="studio-onboard-foot">
              <p>还没有项目。写完第一条 Brief，项目会保存在本机并打开画布。</p>
              <button
                type="button"
                className="studio-btn studio-btn--primary"
                onClick={focusPrompt}
              >
                开始写 Brief
              </button>
            </div>
          </div>
        ) : (
          <ul className="studio-home-list">
            {latestProjects.map((project) => {
              const cover = projectCoverSrc(project);
              return (
                <li key={project.id}>
                  <Link href={`/projects/${project.id}`} className="studio-home-row">
                    <span className="studio-home-thumb">
                      {cover ? <img src={cover} alt="" /> : <VadMark size={16} />}
                    </span>
                    <span className="studio-home-copy">
                      <strong>{project.title}</strong>
                      <span>{homeBlurb(project)}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
