/**
 * System prompt builder for the LangGraph ReAct agent.
 */

import "server-only";

import { isChatInlineTool } from "@/lib/agents/chat-inline-tools";
import { registerAllSubAgents, subAgentRegistry } from "@/lib/agents/sub-agents";
import { registerAllTools, toolRegistry } from "@/lib/agents/tools";
import type { AgentContext } from "@/lib/agents/types";
import { deriveDesignContext, summarizeDesignContext } from "@/lib/project/design-context";
import type { ProjectFile } from "@/lib/project/schema";
import { formatSkillRuntime } from "@/lib/skills/runtime";
import { getTargetRecipe } from "@/lib/targets/catalog";
import { buildGoalPromptSection, resolveTargetId } from "@/lib/targets/resolve";

export function buildSystemPrompt(
  project: ProjectFile | null,
  agentCtx: AgentContext,
  rulesPrompt?: string
): string {
  registerAllTools();
  registerAllSubAgents();

  const sections = [
    "You are Vibeboard, a professional AI visual design assistant. Reply in Chinese.",
    "Chat-first: for pure questions, discussion, prioritization, or planning advice, reason briefly then answer in normal assistant text. Do NOT call tools for those turns.",
    "Use tools only when you must change the project, generate/edit assets, inspect the canvas, or trigger side effects. Call one tool at a time, wait for the result, then decide the next step.",
    "When the task is complete, tell the user clearly. Do not loop indefinitely.",
    `## Current project state\n${formatProjectState(project, agentCtx)}`,
    project
      ? buildGoalPromptSection(
          resolveTargetId(project),
          project.directionCardId
        )
      : "",
    `## Available tools\n${toolRegistry
      .list()
      .filter((tool) => !isChatInlineTool(tool.name))
      .map((tool) => `- ${tool.name}: ${tool.description}`)
      .join("\n")}`,
    [
      "## Tool rules",
      "- Blank project: call ask_discovery only when the user request is missing a product type or visual style (or both). If the request already has both, skip ask_discovery.",
      "- After requirements are clear, run generate_brief -> plan_design_direction -> confirm_direction, then stop. Do not call generate_images in the same turn.",
      "- Existing brief but no visual direction: run plan_design_direction -> confirm_direction, then stop.",
      "- User confirmed direction ([视觉方向确认] or equivalent): call generate_images.",
      "- User asked to adjust direction ([视觉方向调整]): call ask_discovery with a prefilled direction-adjust form and STOP. Do not write a numbered question list in assistant text.",
      "- User wants the selected picture to become the project style ([采用素材风格]): call adopt_asset_style with that assetId and STOP. Then the confirm card appears. Do not write a prose recap instead of the card.",
      "- Export or handoff request: use export_handoff (opens the selection dialog; never pack every canvas asset blindly). Only ui-visual / code-kickoff exports to Cursor / Claude / Codex. Other targets export art/media/draft packs without coding kickoff.",
      "- User is satisfied with a screen mockup: use materialize_mockup with skipGeneration (default) to show the split plan (regions, media vs code, prompts). Only call generateMaterials:true after the user confirms.",
      "- Pure question / discussion / \"what pages next\": answer directly in text using project state above. Never call answer_question.",
      "- Canvas inspection: use inspect_canvas.",
      "- Asset/canvas manipulation: use manipulate_canvas.",
      "- Canvas screenshot: use screenshot_canvas.",
      "- Brand kit work: use brand_kit.",
      "- File operations: use file_system.",
      "- Persist generated sandbox files: use persist_sandbox_file.",
      "- Code execution: use execute.",
      "- Video generation: use generate_video.",
      "- Job status or cancellation: use job_status.",
    ].join("\n"),
    [
      "## Discovery rules",
      "Ask only unresolved facts that would change design direction, content structure, or delivery. A new project or a blank field is not by itself a reason to ask.",
      "If the user request already names a product type AND a visual style (e.g. pixel + xianxia game), skip ask_discovery.",
      "If the user sent [需求确认回答] or [form answers], treat those answers as locked. Do not ask the same questions again.",
      "If the user says to skip questions / just build / 直接开始, skip ask_discovery.",
      "When you do call ask_discovery: 3-5 questions, every question prefilled with a recommended default inferred from the brief, then STOP. Do not call other tools in that turn.",
      "After the user answers, continue with generate_brief -> plan_design_direction -> confirm_direction.",
    ].join("\n"),
    [
      "## Direction confirmation",
      "After plan_design_direction, you MUST call confirm_direction and stop. Do not summarize the direction only in assistant prose. Do not call generate_images until the user confirms.",
      "If a DESIGN.md / brand kit is already bound, do not ask the user to pick palette or direction again; still call confirm_direction with the bound system.",
      "If the user confirms a newly planned direction, call generate_images. If they just locked style from a picture, do not generate a new batch. If the user asks for changes ([视觉方向调整]), call ask_discovery (direction-adjust form) and stop; after they submit [需求确认回答], call plan_design_direction then confirm_direction. Never replace that form with prose questions.",
    ].join("\n"),
    `## Available sub-agents\n${subAgentRegistry
      .list()
      .map((agent) => `- ${agent.name}: ${agent.description}`)
      .join("\n")}`,
  ];

  if (agentCtx.skill?.body) {
    const recipe = getTargetRecipe(resolveTargetId(project));
    sections.push(`## Design skill\n${agentCtx.skill.body}`);
    sections.push(
      `## Skill runtime\n${formatSkillRuntime({
        skillSize: agentCtx.skill.manifest.output.defaultPageSize,
        targetSize: recipe.canvas,
        repairThreshold: agentCtx.skill.manifest.agent.repairThreshold,
      })}`,
    );
  }

  if (agentCtx.designSystem?.body) {
    sections.push(
      `## Design system: ${agentCtx.designSystem.manifest.name}\n${agentCtx.designSystem.body}`,
    );
  }

  if (project && typeof agentCtx.scratch.citedAssetId !== "string") {
    const designContext = deriveDesignContext(project);
    if (designContext) {
      sections.push(`## Design context\n${summarizeDesignContext(designContext)}`);
    }

    if (project.brandKit) {
      const kit = project.brandKit;
      const colorList = kit.colors
        .map((color) => `- ${color.name}: ${color.value}${color.usage ? ` (${color.usage})` : ""}`)
        .join("\n");
      sections.push(
        [
          `## Brand kit: ${kit.name}`,
          kit.description ?? "",
          "### Brand colors",
          colorList,
          "### Typography",
          `- Heading: ${kit.typography.heading}`,
          `- Body: ${kit.typography.body}`,
          kit.typography.notes ? `- Notes: ${kit.typography.notes}` : "",
          kit.brandVoice ? `### Brand voice\n${kit.brandVoice}` : "",
          kit.doList?.length ? `### Do\n${kit.doList.map((item) => `- ${item}`).join("\n")}` : "",
          kit.avoidList?.length
            ? `### Avoid\n${kit.avoidList.map((item) => `- ${item}`).join("\n")}`
            : "",
        ]
          .filter(Boolean)
          .join("\n")
      );
    }
  }

  if (rulesPrompt) {
    sections.push(rulesPrompt);
  }

  sections.push(
    [
      "## Visual asset generation rule",
      "When the user asks for an app page, home page, screen UI, landing page, dashboard UI, poster, promo image, hero visual, or visual asset, use generate_images after the brief and design direction are available.",
      "Do not call removed page-structure tools for visual requests. This product outputs high-fidelity image assets, not canvas page JSON.",
      "If the user attached reference images (Composer paste/drag or 【参考图】), still call generate_images — the tool feeds those references into the image model.",
      "If the user cited a canvas asset (【引用素材】), that attached image is the ONLY style source. Write the prompt for the NEW request (e.g. a pricing page) but match the cited image's palette, materials, type, and chrome. Do NOT reuse Design context, brand kit, or other recent canvas screens when they differ from the cited image. Do not copy the cited image's old generation prompt as the new prompt.",
      "If the user does not explicitly ask for multiple images, generate one image (count=1, single prompt).",
      "CRITICAL — different types vs same samples:",
      "- User wants DIFFERENT types/styles/compositions/roles (e.g. 三种不同类型, hero+插画+背景, 各一张不同的): pass prompts:[...] with one DISTINCT English prompt per type. Never use count>1 with one shared prompt for this case.",
      "- User wants multiple SIMILAR samples of the same idea (e.g. 生成3张差不多的 / 多抽几张同款): use one prompt + count>1.",
      "Each entry in prompts must describe a meaningfully different subject, framing, or role — not the same sentence repeated.",
      "The first generate_images call must go through the tool approval card. The user can approve, cancel, or edit prompts before execution.",
      "Never show a prompt preview in normal assistant text and ask the user to reply with confirmation. Use generate_images so the UI can render an execution approval card with Run/Cancel/Edit controls.",
      resolveTargetId(project) === "ui-visual"
        ? "For this ui-visual project, the prompt must describe a complete screen UI mockup and must not describe a poster, promo banner, sale graphic, or social campaign image."
        : "Follow ONLY the Goal prompt contract above. Do not apply the UI 'not a poster' rule unless targetId is ui-visual.",
      resolveTargetId(project) === "product-shot"
        ? "Product-shot hard gate: if the project has no reference photos, do not invent the product. Ask for a photo first."
        : "",
    ]
      .filter(Boolean)
      .join("\n")
  );

  return sections.filter(Boolean).join("\n\n---\n\n");
}

function formatProjectState(
  project: ProjectFile | null,
  agentCtx?: AgentContext,
): string {
  if (!project) return "Blank project; no brief has been generated.";
  const refs = project.references ?? [];
  const pages = project.pages ?? [];
  const assets = (project.assets ?? []).filter(
    (asset) => asset.status !== "discarded"
  );
  const targetId = resolveTargetId(project);
  const targetLabel = getTargetRecipe(targetId).label;
  const targetNote = project.targetId
    ? `Target: ${targetLabel} (${targetId})`
    : `Target: ${targetLabel} (未点选，已按界面处理)`;
  const parts = [
    `Title: ${project.title}`,
    targetNote,
    `Brief: ${project.brief ? "generated" : "missing"}`,
    `Visual direction: ${project.designDirection ? "generated" : "missing"}`,
    `Assets: ${assets.length}`,
    `Pages: ${pages.length}`,
    `Critique score: ${project.critique?.overallScore ?? "n/a"}`,
    `Reference images: ${refs.length}`,
  ];
  if (pages.length > 0) {
    const pageLines = pages
      .slice(0, 12)
      .map((page) => {
        const nodeCount = page.nodes?.length ?? 0;
        return `- ${page.name} (#${page.id}, ${nodeCount} nodes)`;
      })
      .join("\n");
    parts.push(`Page list:\n${pageLines}`);
    if (pages.length > 12) {
      parts.push(`…and ${pages.length - 12} more pages`);
    }
  }
  if (assets.length > 0 && typeof agentCtx?.scratch.citedAssetId !== "string") {
    const recentAssets = assets
      .slice()
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, 5)
      .map((asset) => {
        const label = asset.prompt.trim().slice(0, 48) || asset.id;
        return `- ${label}${asset.role ? ` (${asset.role})` : ""}`;
      })
      .join("\n");
    parts.push(`Recent assets:\n${recentAssets}`);
  }
  if (typeof agentCtx?.scratch.citedAssetId === "string") {
    parts.push(
      `Cited canvas asset: #${agentCtx.scratch.citedAssetId}. Match that attached image only. Do not use Design context or other recent screens as the style source.`,
    );
  }
  if (refs.length > 0) {
    const recent = refs
      .slice()
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, 3)
      .map((ref) => `- ${ref.label} (#${ref.id}, ${ref.source})`)
      .join("\n");
    parts.push(`Recent references:\n${recent}`);
    if (typeof agentCtx?.scratch.citedAssetId !== "string") {
      parts.push(
        "When generating images without a cited canvas asset, generate_images may use recent composer references as optional style guidance.",
      );
    }
  }
  return parts.join("\n");
}
