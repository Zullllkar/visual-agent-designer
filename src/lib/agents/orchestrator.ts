/**
 * @deprecated Internal fallback workflow only. Formal runtime is WebSocket +
 * LangGraph ReAct; this fixed pipeline must not be used as a second product
 * entry point. AgentRunService may call it only after the LLM is unavailable.
 *
 * 工作流：用户一句话想法 → ProjectFile
 * --------------------------------------------------------------
 * 委托 design-pipeline 执行完整 LLM Agent + 生图流水线。
 *
 * @author：wangjunhua
 */

import { nanoid } from "nanoid";
import type { AgentContext } from "./types";
import type { ProjectFile } from "@/lib/project/schema";
import {
  resolveProviders,
  type ProviderConfig,
} from "@/lib/providers/registry";
import { resolveSkillContext } from "@/lib/skills/context";
import { runDesignPipeline } from "./design-pipeline";
import type { PipelineProgress } from "./design-pipeline";
import { assertRealLlmForAgents } from "@/lib/providers/validate";
import { PipelineLogger } from "./pipeline-logger";
import { appendPipelineLogEntry } from "@/lib/vad/pipeline-log-persist";
import type { CodeDiffEventData } from "./chat-schema";

export interface GenerateProjectOptions {
  providerConfig?: ProviderConfig;
  /** 预分配项目 id（SSE 流需与日志路径一致） */
  projectId?: string;
  /** 首页占位项目等：合并 slug / createdAt */
  existing?: ProjectFile | null;
  logger?: PipelineLogger;
  onProgress?: (p: PipelineProgress) => void;
  onCodeDiff?: (diff: CodeDiffEventData) => void;
  onProjectSnapshot?: (project: ProjectFile) => void;
  onThinking?: (text: string) => void;
}

function normalizeGenerateOptions(
  arg?: ProviderConfig | GenerateProjectOptions
): GenerateProjectOptions {
  if (!arg) return {};
  if ("llm" in arg || "image" in arg || "sliders" in arg) {
    return { providerConfig: arg as ProviderConfig };
  }
  return arg as GenerateProjectOptions;
}

export async function generateProjectFromIdea(
  idea: string,
  optionsOrConfig?: ProviderConfig | GenerateProjectOptions
): Promise<ProjectFile> {
  const opts = normalizeGenerateOptions(optionsOrConfig);
  const providerConfig = opts.providerConfig;
  assertRealLlmForAgents(providerConfig);

  const projectId = opts.projectId ?? nanoid(10);
  const runId = opts.logger?.runId ?? nanoid(8);

  const logger =
    opts.logger ??
    new PipelineLogger({
      runId,
      projectId,
      source: "generate",
      idea,
      onEntry: (entry) => {
        void appendPipelineLogEntry(projectId, entry, {
          runId,
          source: "generate",
        }).catch((e) =>
          console.warn("[VAD] pipeline log persist failed:", e)
        );
      },
    });

  logger.info("init", "解析 Skill 与设计系统");
  const { skill, designSystem, requestedSkillId, skillMissing } =
    await resolveSkillContext(providerConfig, opts.existing);
  if (skillMissing) {
    logger.info("skill", `项目绑定的 Skill「${requestedSkillId}」不存在，本轮不注入 Skill`);
  } else if (skill) {
    logger.info(
      "skill",
      `使用 Skill：${skill.manifest.name}${skill.manifest.version ? ` @ ${skill.manifest.version}` : ""}`
    );
  }

  const ctx: AgentContext = {
    projectId,
    scratch: {
      pipelineLogger: logger,
      ...(opts.existing?.targetId ? { targetId: opts.existing.targetId } : {}),
    },
    providers: resolveProviders(providerConfig),
    skill,
    designSystem,
  };

  const onProgress = (p: PipelineProgress) => {
    opts.onProgress?.(p);
    if (p.detail) {
      logger.info(p.stage, p.detail);
    }
  };

  try {
    const project = await runDesignPipeline({
      idea,
      ctx,
      providerConfig,
      existing: opts.existing,
      logger,
      onProgress,
      onCodeDiff: opts.onCodeDiff,
      onProjectSnapshot: opts.onProjectSnapshot,
      onThinking: opts.onThinking,
    });
    logger.complete(
      `项目「${project.title}」· ${project.pages.length} 页 · 总分 ${project.critique?.overallScore ?? "—"}`
    );
    return project;
  } catch (e) {
    logger.fail(e);
    throw e;
  }
}
