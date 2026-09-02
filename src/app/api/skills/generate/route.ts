/**
 * POST /api/skills/generate
 * 
 * 根据用户自然语言描述生成新的 Skill
 */

import { NextRequest, NextResponse } from "next/server";
import { runSkillGeneratorAgent } from "@/lib/agents/skill-generator-agent";
import type { AgentContext } from "@/lib/agents/types";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { input } = body;

    if (!input || typeof input !== "string") {
      return NextResponse.json(
        { error: "缺少输入参数：input" },
        { status: 400 }
      );
    }

    // 构建 AgentContext（简化版）
    const ctx: Partial<AgentContext> = {
      projectId: "temp-skill-gen",
      scratch: {},
    };

    // 调用 SkillGeneratorAgent
    const result = await runSkillGeneratorAgent(input, ctx);

    if (!result.success) {
      return NextResponse.json(
        { success: false, message: result.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: result.message,
      skillId: result.skillId,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "未知错误";
    console.error("[POST /api/skills/generate]", { error: errorMessage });

    return NextResponse.json(
      { success: false, message: `服务器错误：${errorMessage}` },
      { status: 500 }
    );
  }
}
