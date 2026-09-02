"use client";

import { useState } from "react";
import { Sparkles, CheckCircle, XCircle, Loader2 } from "lucide-react";

interface SkillGeneratorPanelProps {
  onSkillCreated?: (skillId: string) => void;
  className?: string;
}

export function SkillGeneratorPanel({
  onSkillCreated,
  className = "",
}: SkillGeneratorPanelProps) {
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">(
    "idle"
  );
  const [result, setResult] = useState<{
    success: boolean;
    message: string;
    skillId?: string;
  }>({ success: false, message: "" });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!input.trim()) return;

    setStatus("loading");
    setResult({ success: false, message: "" });

    try {
      const response = await fetch("/api/skills/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: input.trim() }),
      });

      const data = await response.json();

      if (data.success) {
        setStatus("success");
        setResult({
          success: true,
          message: data.message || "Skill 创建成功！",
          skillId: data.skillId,
        });
        onSkillCreated?.(data.skillId);
      } else {
        setStatus("error");
        setResult({
          success: false,
          message: data.message || "Skill 创建失败",
        });
      }
    } catch (error) {
      setStatus("error");
      setResult({
        success: false,
        message: error instanceof Error ? error.message : "网络错误",
      });
    }
  };

  return (
    <div className={`bg-white dark:bg-gray-800 p-4 rounded-lg ${className}`}>
      <h3 className="font-semibold text-lg mb-3 flex items-center gap-2">
        <Sparkles className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
        帮你生成 Skill
      </h3>

      <form onSubmit={handleSubmit}>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
          告诉我你想要什么类型的技能：
        </p>

        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="例如：'我想创建一个小红书封面生成技能' 或 '帮我做一个游戏宣传图生成的技能'"
          className="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-lg min-h-[120px] resize-y focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-700 dark:text-white mb-3"
          disabled={status === "loading"}
        />

        <button
          type="submit"
          disabled={status === "loading" || !input.trim()}
          className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white py-3 px-4 rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 flex items-center justify-center gap-2"
        >
          {status === "loading" ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              正在生成...
            </>
          ) : (
            <>
              <Sparkles className="w-5 h-5" />
              ✨ 生成 Skill
            </>
          )}
        </button>
      </form>

      {/* Success State */}
      {status === "success" && (
        <div className="mt-4 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
          <div className="flex items-start gap-3">
            <CheckCircle className="w-6 h-6 text-green-600 dark:text-green-400 shrink-0 mt-0.5" />
            <div>
              <h4 className="font-semibold text-green-800 dark:text-green-300 mb-1">
                {result.message}
              </h4>
              {result.skillId && (
                <p className="text-sm text-green-600 dark:text-green-400">
                  Skill ID: <code className="bg-green-100 dark:bg-green-800 px-2 py-1 rounded">{result.skillId}</code>
                </p>
              )}
              <p className="text-sm text-green-600 dark:text-green-400 mt-2">
                你可以在「技能管理」中看到并使用它
              </p>
              <button
                onClick={() => {
                  setStatus("idle");
                  setInput("");
                  setResult({ success: false, message: "" });
                }}
                className="mt-3 text-sm text-green-700 dark:text-green-300 underline hover:no-underline"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Error State */}
      {status === "error" && (
        <div className="mt-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <div className="flex items-start gap-3">
            <XCircle className="w-6 h-6 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
            <div>
              <h4 className="font-semibold text-red-800 dark:text-red-300 mb-1">
                创建失败
              </h4>
              <p className="text-sm text-red-600 dark:text-red-400">{result.message}</p>
              <button
                onClick={() => {
                  setStatus("idle");
                  setResult({ success: false, message: "" });
                }}
                className="mt-3 text-sm text-red-700 dark:text-red-300 underline hover:no-underline"
              >
                重试
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
