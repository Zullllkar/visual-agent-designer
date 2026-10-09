/**
 * Sub-Agent 统一注册入口
 * --------------------------------------------------------------
 */

import { subAgentRegistry } from "./registry";
import { imageGenSubAgent } from "./image-gen-sub-agent";
import { handoffSubAgent } from "./handoff-sub-agent";
import { specializedWorkflowSubAgent } from "./specialized-workflow-sub-agent";

let registered = false;

export function registerAllSubAgents(): void {
  if (registered) return;
  subAgentRegistry.register(imageGenSubAgent);
  subAgentRegistry.register(handoffSubAgent);
  subAgentRegistry.register(specializedWorkflowSubAgent);
  registered = true;
}

export { subAgentRegistry } from "./registry";
export type { SubAgent, SubAgentInput, SubAgentOutput } from "./types";
