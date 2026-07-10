/**
 * LLM 输出工具
 * --------------------------------------------------------------
 * 统一识别 Mock Provider 占位输出，避免各 Agent 重复硬编码前缀。
 *
 * @author：wangjunhua
 */

/** MockLlmProvider 固定返回此前缀，表示未配置真实模型。 */
export const MOCK_LLM_PREFIX = "MOCK_LLM_OUTPUT::";

export function isMockLlmText(text?: string | null): boolean {
  return !text || text.startsWith(MOCK_LLM_PREFIX);
}
