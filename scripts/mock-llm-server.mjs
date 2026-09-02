/**
 * 本地 mock OpenAI 兼容服务
 * --------------------------------------------------------------
 * 仅用于开发期验证 LayoutAgent v2 的 LLM → materialize 路径。
 *
 * 用法：
 *   node scripts/mock-llm-server.mjs            # 默认 :8765
 *
 * 在 Vibeboard 设置里：
 *   baseURL=http://localhost:8765/v1
 *   apiKey=任意（不会校验）
 *   model=mock-layout
 */

import { createServer } from "node:http";

const PORT = process.env.PORT ? Number(process.env.PORT) : 8765;

/**
 * 不维护跨调用全局状态。Critic 评分基于"被评页是否已被 Repair 过"。
 * 约定：RepairAgent 输出的修订页第一行文字以「（已修复）」开头；
 * Critic 看到此标记即返回高分，否则返回低分，从而驱动 orchestrator
 * 触发一轮 Repair，闭环完成 demo。
 */

const server = createServer(async (req, res) => {
  if (req.method !== "POST" || !req.url.endsWith("/chat/completions")) {
    res.statusCode = 404;
    res.end("not found");
    return;
  }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  const sys = body.messages?.find((m) => m.role === "system")?.content ?? "";
  const isLayout = sys.includes("UI 设计师 Agent");
  const isBrief = sys.includes("产品经理助手");
  const isCritic = sys.includes("UI 视觉评审 Agent");
  const isRepair = sys.includes("UI Repair Agent");
  const isVision = sys.includes("UI Vision Critic");

  // 检测 user message 是否带 image_url（vision 请求）
  const userMsgRaw = body.messages?.find((m) => m.role === "user")?.content;
  const hasImageBlock =
    Array.isArray(userMsgRaw) &&
    userMsgRaw.some((b) => b && b.type === "image_url" && b.image_url?.url);

  let content;
  if (isVision) {
    // 收到了带图的 vision 评审请求；user content 是数组形式
    const userText = Array.isArray(userMsgRaw)
      ? (userMsgRaw.find((b) => b?.type === "text")?.text ?? "")
      : String(userMsgRaw ?? "");
    const pageIdMatch = userText.match(/"id"\s*:\s*"([^"]+)"/);
    const pageId = pageIdMatch ? pageIdMatch[1] : "home";
    // 只有真带图才返回 vision report；否则返回非 JSON 让上游回退
    if (!hasImageBlock) {
      content = "no image attached";
    } else {
      content = JSON.stringify({
        pageId,
        score: 7.2,
        summary:
          "（vision mock）整体视觉清晰，hero 区视觉重心明显；卡片对比度可再提升。",
        issues: [
          {
            severity: "medium",
            category: "color",
            message: "卡片边框与画布底色对比度较弱，远看几乎平面。",
            suggestion: "卡片描边换深一档（#D4D4D8）或加 1px 阴影。",
          },
          {
            severity: "low",
            category: "spacing",
            message: "首屏 CTA 距底部边缘留白略紧。",
            suggestion: "下移到距底 32px 以上。",
          },
        ],
      });
    }
  } else if (isRepair) {
    // 从用户消息里抽出当前页的 JSON 片段，回填同名同尺寸的修订页（演示用）
    const userMsg = body.messages?.find((m) => m.role === "user")?.content ?? "";
    const widthMatch = userMsg.match(/"width"\s*:\s*(\d+)/);
    const heightMatch = userMsg.match(/"height"\s*:\s*(\d+)/);
    const nameMatch = userMsg.match(/"name"\s*:\s*"([^"]+)"/);
    const width = widthMatch ? Number(widthMatch[1]) : 390;
    const height = heightMatch ? Number(heightMatch[1]) : 844;
    const name = nameMatch ? nameMatch[1] : "首页";
    content = JSON.stringify({
      name,
      width,
      height,
      background: "#F4F4F5",
      nodes: [
        {
          type: "text",
          x: 24,
          y: 56,
          width: width - 48,
          height: 40,
          content: "（已修复）" + name,
          fontSize: 32,
          fontWeight: 700,
          color: "#111827",
        },
        {
          type: "text",
          x: 24,
          y: 100,
          width: width - 48,
          height: 20,
          content: "Repair Agent：层级、对比度与文案均已微调。",
          fontSize: 13,
          color: "#52525B",
        },
        {
          type: "image",
          x: 24,
          y: 132,
          width: width - 48,
          height: Math.min(180, height - 220),
          imagePrompt: "calm AI productivity hero, refined contrast",
          radius: 16,
        },
        {
          type: "button",
          x: 24,
          y: height - 80,
          width: width - 48,
          height: 48,
          label: "立即开始",
          fill: "#111827",
          color: "#FFFFFF",
          radius: 24,
        },
      ],
    });
  } else if (isCritic) {
    const userMsg = body.messages?.find((m) => m.role === "user")?.content ?? "";
    const pageIdMatch = userMsg.match(/"id"\s*:\s*"([^"]+)"/);
    const pageId = pageIdMatch ? pageIdMatch[1] : "home";

    // Critic 看到"（已修复）"标记则视作 Repair 已应用，给高分；否则给低分
    const isRepaired = userMsg.includes("（已修复）");
    const score = isRepaired ? 8.5 : 6.2;
    const issues =
      score >= 8.5
        ? []
        : score >= 7.5
          ? [
              {
                severity: "low",
                category: "color",
                message: "卡片背景与画布底色对比度可再提升。",
                suggestion: "卡片加 1px #E4E4E7 边框。",
              },
            ]
          : [
              {
                severity: "medium",
                category: "hierarchy",
                message: "主标题与副标题字号差异不够明显。",
                suggestion: "把主标题提升到 32，副标题降至 13。",
              },
              {
                severity: "medium",
                category: "color",
                message: "整体配色偏单调，与 brief.visualStyle 不够吻合。",
                suggestion: "为 hero 加渐变；为 CTA 用品牌主色。",
              },
              {
                severity: "low",
                category: "content",
                message: "卡片正文比较泛泛，建议引用 coreFeatures 原文。",
              },
            ];

    content = JSON.stringify({
      pageId,
      score,
      summary:
        score >= 8.5
          ? "整体已经很到位，无明显改进空间。"
          : score >= 7.5
            ? "层级与文案到位，对比度可再上一档。"
            : "文案与视觉对比偏弱，需要 Repair 调整。",
      issues,
    });
  } else if (isBrief) {
    content = JSON.stringify({
      productName: "Mock 灵感日程",
      positioning: "AI 驱动的独立开发者灵感记录与日程工具",
      targetUser: "独立开发者与设计师",
      scenarios: [
        "随时记录灵感并自动归档",
        "把灵感串成可执行的项目计划",
        "导出 Cursor 友好的开发上下文包",
      ],
      coreFeatures: ["灵感速记", "项目计划生成", "Cursor 导出", "周回顾"],
      platform: "app",
      visualStyle: "calm AI productivity",
      outputTargets: ["cursor", "claude-code", "markdown"],
    });
  } else if (isLayout) {
    content = JSON.stringify({
      pages: [
        {
          name: "首页",
          width: 390,
          height: 844,
          background: "#F4F4F5",
          nodes: [
            {
              type: "text",
              x: 24,
              y: 64,
              width: 320,
              height: 36,
              content: "Mock 灵感日程",
              fontSize: 28,
              fontWeight: 700,
              color: "#111827",
            },
            {
              type: "text",
              x: 24,
              y: 104,
              width: 320,
              height: 22,
              content: "随手记录灵感，AI 帮你串成可执行的计划",
              fontSize: 14,
              color: "#6B7280",
            },
            {
              type: "image",
              x: 24,
              y: 144,
              width: 342,
              height: 180,
              imagePrompt: "calm AI productivity hero, soft purple gradient",
              radius: 16,
            },
            {
              type: "card",
              x: 24,
              y: 348,
              width: 342,
              height: 88,
              title: "灵感速记",
              body: "30 秒抓住每一个一闪而过的想法",
              fill: "#FFFFFF",
              radius: 12,
            },
            {
              type: "card",
              x: 24,
              y: 448,
              width: 342,
              height: 88,
              title: "项目计划生成",
              body: "把零碎的灵感拼成一个可推进的项目",
              fill: "#FFFFFF",
              radius: 12,
            },
            {
              type: "button",
              x: 24,
              y: 760,
              width: 342,
              height: 48,
              label: "立即开始",
              fill: "#111827",
              color: "#FFFFFF",
              radius: 24,
            },
          ],
        },
        {
          name: "今日",
          width: 390,
          height: 844,
          background: "#F4F4F5",
          nodes: [
            {
              type: "text",
              x: 24,
              y: 64,
              width: 320,
              height: 28,
              content: "今日灵感",
              fontSize: 22,
              fontWeight: 600,
              color: "#111827",
            },
            {
              type: "card",
              x: 24,
              y: 110,
              width: 342,
              height: 220,
              title: "用 LLM 直接产出 Canvas",
              body: "结合 schema 校验和图像模型，端到端跑通设计交付",
              fill: "#FFFFFF",
              radius: 16,
            },
          ],
        },
      ],
    });
  } else {
    content = JSON.stringify({ error: "unknown system prompt" });
  }

  res.setHeader("content-type", "application/json");
  res.end(
    JSON.stringify({
      id: "mock",
      object: "chat.completion",
      choices: [{ index: 0, message: { role: "assistant", content } }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    })
  );
});

server.listen(PORT, () => {
  console.log(`[mock-llm-server] listening on http://localhost:${PORT}`);
});
