/**
 * Canonical tool contract shared by the server, chat schema and timeline.
 * Keep this file free of server-only imports so client code can use it safely.
 */
export const TOOL_CONTRACTS = {
  ask_discovery: { label: "了解需求", phase: "DISCOVERY", risk: "safe" },
  answer_question: { label: "回答问题", phase: "REVIEW", risk: "safe" },
  brand_kit: { label: "读取品牌规范", phase: "DIRECTION", risk: "safe" },
  confirm_direction: { label: "确认设计方向", phase: "DIRECTION", risk: "safe" },
  adopt_asset_style: { label: "采纳素材风格", phase: "DIRECTION", risk: "moderate" },
  generate_brief: { label: "生成 Brief", phase: "BRIEF", risk: "safe" },
  plan_design_direction: { label: "规划设计方向", phase: "DIRECTION", risk: "safe" },
  generate_images: { label: "生成图片", phase: "GENERATION", risk: "moderate" },
  generate_image_variants: { label: "生成图片变体", phase: "GENERATION", risk: "moderate" },
  restyle_page_images: { label: "统一图片风格", phase: "REFINEMENT", risk: "moderate" },
  restyle_images: { label: "重绘图片", phase: "REFINEMENT", risk: "moderate" },
  generate_video: { label: "生成视频", phase: "GENERATION", risk: "moderate" },
  materialize_mockup: { label: "制作 Mockup", phase: "GENERATION", risk: "moderate" },
  materialize_slots: { label: "拆解为素材", phase: "GENERATION", risk: "moderate" },
  inspect_canvas: { label: "检查画布", phase: "REVIEW", risk: "safe" },
  review_project: { label: "评审项目", phase: "REVIEW", risk: "safe" },
  plan_assets: { label: "规划素材", phase: "ASSET_PLAN", risk: "safe" },
  repair_project: { label: "修复项目", phase: "REFINEMENT", risk: "moderate" },
  restore_project_revision: { label: "恢复修订", phase: "REVIEW", risk: "moderate" },
  screenshot_canvas: { label: "截取画布", phase: "REVIEW", risk: "safe" },
  manipulate_canvas: { label: "修改画布", phase: "REFINEMENT", risk: "moderate" },
  upsert_canvas_note: { label: "更新画布备注", phase: "REFINEMENT", risk: "moderate" },
  star_asset: { label: "收藏素材", phase: "REVIEW", risk: "safe" },
  batch_delete_assets: { label: "删除素材", phase: "REFINEMENT", risk: "destructive" },
  export_handoff: { label: "导出 Handoff", phase: "HANDOFF", risk: "external" },
  delegate_task: { label: "委派专业任务", phase: "REVIEW", risk: "moderate" },
  file_system: { label: "读写工作区", phase: "HANDOFF", risk: "external" },
  persist_sandbox_file: { label: "保存工作区文件", phase: "HANDOFF", risk: "external" },
  execute: { label: "执行命令", phase: "HANDOFF", risk: "external" },
  job_status: { label: "查看任务状态", phase: "GENERATION", risk: "safe" },
  // Legacy planner names remain parseable for replaying old conversations.
  plan_architecture: { label: "规划架构", phase: "BRIEF", risk: "safe" },
  generate_layout: { label: "生成布局", phase: "ASSET_PLAN", risk: "moderate" },
  polish_content: { label: "润色内容", phase: "REFINEMENT", risk: "moderate" },
  edit_page: { label: "编辑页面", phase: "REFINEMENT", risk: "moderate" },
  critique_pages: { label: "评审页面", phase: "REVIEW", risk: "safe" },
  repair_page: { label: "修复页面", phase: "REFINEMENT", risk: "moderate" },
} as const;

export type ToolName = keyof typeof TOOL_CONTRACTS;
export type ToolContractPhase = (typeof TOOL_CONTRACTS)[ToolName]["phase"];
export type ToolContractRisk = (typeof TOOL_CONTRACTS)[ToolName]["risk"];
export const TOOL_NAMES = Object.keys(TOOL_CONTRACTS) as [ToolName, ...ToolName[]];

export function toolContract(name: string) {
  return TOOL_CONTRACTS[name as ToolName];
}
