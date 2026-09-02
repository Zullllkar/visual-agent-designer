/**
 * 工具统一注册入口
 * --------------------------------------------------------------
 * 在应用启动时调用 registerAllTools() 注册所有工具。
 */

import { toolRegistry } from "./registry";
import { generateBriefTool } from "./generate-brief";
import { planDesignDirectionTool } from "./plan-design-direction";
import { generateImagesTool } from "./generate-images";
import { generateImageVariantsTool } from "./generate-image-variants";
import { restyleImagesTool } from "./restyle-images";
import { exportHandoffTool } from "./export-handoff";
import { materializeMockupTool } from "./materialize-mockup";
import { answerQuestionTool } from "./answer-question";
import { inspectCanvasTool } from "./inspect-canvas";
import { manipulateCanvasTool } from "./manipulate-canvas";
import { starAssetTool } from "./star-asset";
import { batchDeleteAssetsTool } from "./batch-delete-assets";
import { delegateTaskTool } from "./delegate-task";
import { screenshotCanvasTool } from "./screenshot-canvas";
import { brandKitTool } from "./brand-kit";
import { fileSystemTool } from "./file-system";
import { persistSandboxFileTool } from "./persist-sandbox-file";
import { executeTool } from "./execute";
import { generateVideoTool } from "./generate-video";
import { jobStatusTool } from "./job-status";
import { askDiscoveryTool } from "./ask-discovery";
import { confirmDirectionTool } from "./confirm-direction";
import { adoptAssetStyleTool } from "./adopt-asset-style";

let registered = false;

export function registerAllTools(): void {
  if (registered) return;
  toolRegistry.register(generateBriefTool);
  toolRegistry.register(planDesignDirectionTool);
  toolRegistry.register(generateImagesTool);
  toolRegistry.register(generateImageVariantsTool);
  toolRegistry.register(restyleImagesTool);
  toolRegistry.register(exportHandoffTool);
  toolRegistry.register(materializeMockupTool);
  toolRegistry.register(answerQuestionTool);
  toolRegistry.register(inspectCanvasTool);
  toolRegistry.register(manipulateCanvasTool);
  toolRegistry.register(starAssetTool);
  toolRegistry.register(batchDeleteAssetsTool);
  toolRegistry.register(delegateTaskTool);
  toolRegistry.register(screenshotCanvasTool);
  toolRegistry.register(brandKitTool);
  toolRegistry.register(fileSystemTool);
  toolRegistry.register(persistSandboxFileTool);
  toolRegistry.register(executeTool);
  toolRegistry.register(generateVideoTool);
  toolRegistry.register(jobStatusTool);
  toolRegistry.register(askDiscoveryTool);
  toolRegistry.register(confirmDirectionTool);
  toolRegistry.register(adoptAssetStyleTool);
  registered = true;
}

export { toolRegistry } from "./registry";
export type { AgentTool, ToolContext, ToolResult, RiskLevel } from "./types";
export { type AgentPhase, phaseLabel, resolveNextPhase } from "../agent-phase";
export { jobScheduler } from "../job/job-scheduler";
export { registerAllJobHandlers } from "../job/job-handlers";
export type { Job, JobEvent, JobStatus, JobType, SubmitJobInput } from "../job/job-types";
