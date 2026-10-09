import type { RiskLevel } from "./types";

const TOOL_RISK: Record<string, RiskLevel> = {
  ask_discovery: "safe",
  answer_question: "safe",
  brand_kit: "safe",
  confirm_direction: "safe",
  adopt_asset_style: "moderate",
  generate_brief: "safe",
  inspect_canvas: "safe",
  job_status: "safe",
  plan_design_direction: "safe",
  screenshot_canvas: "safe",
  star_asset: "safe",
  delegate_task: "moderate",
  execute: "external",
  export_handoff: "external",
  file_system: "external",
  generate_image_variants: "moderate",
  generate_images: "moderate",
  generate_video: "moderate",
  materialize_mockup: "moderate",
  manipulate_canvas: "moderate",
  persist_sandbox_file: "external",
  restyle_images: "moderate",
  restyle_page_images: "moderate",
  batch_delete_assets: "destructive",
};

const CONFIRMATION_REQUIRED = new Set([
  "batch_delete_assets",
  "execute",
  "export_handoff",
  "file_system",
  "generate_image_variants",
  "generate_images",
  "generate_video",
  "materialize_mockup",
  "manipulate_canvas",
  "persist_sandbox_file",
  "restyle_images",
  "restyle_page_images",
]);

export function toolRiskLevel(toolName: string | undefined): RiskLevel {
  if (!toolName) return "safe";
  return TOOL_RISK[toolName] ?? "moderate";
}

export function toolRequiresConfirmation(toolName: string | undefined): boolean {
  if (!toolName) return false;
  return CONFIRMATION_REQUIRED.has(toolName) || toolRiskLevel(toolName) === "destructive";
}
