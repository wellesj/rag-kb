"use client";

import { useChat } from "@ai-sdk/react";
import { useMemo, useState } from "react";
import { AssistantMarkdown } from "@/components/AssistantMarkdown";

type RagSource = {
  id: string;
  index: number;
  score: number;
  content: string;
};

/**
 * 从消息 parts 中取 data-sources 引用（服务端随 UI message stream 回传）。
 * 只取最后一条助手消息的引用，与当前回答对应。
 */
function extractSources(message: {
  parts: { type: string; data?: unknown }[];
}): RagSource[] {
  const parts = message.parts ?? [];
  for (const part of parts) {
    if (part.type === "data-sources" && Array.isArray(part.data)) {
      return part.data as RagSource[];
    }
  }
  return [];
}

export function RagChat() {
  const {
    messages,
    sendMessage,
    status,
    stop,
    regenerate,
    error,
    clearError,
  } = useChat();

  const [input, setInput] = useState("");

  const isStreaming = status === "submitted" || status === "streaming";

  const lastAssistant = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") return messages[i];
    }
    return null;
  }, [messages]);

  const sources = lastAssistant ? extractSources(lastAssistant) : [];

  const handleSend = () => {
    const text = input.trim();
    if (!text || isStreaming) return;
    setInput("");
    void sendMessage({ text });
  };

  return (
    <section className="space-y-3" aria-labelledby="chat-heading">
      <h2
        id="chat-heading"
        className="text-sm font-medium text-zinc-800 dark:text-zinc-200"
      >
        4. 流式问答（检索增强）
      </h2>
      <p className="text-xs leading-5 text-zinc-500 dark:text-zinc-400">
        提问 → 服务端检索 topK → 拼进 Prompt → DeepSeek 流式回答，引用来源随流回传。
      </p>

      {/* 消息列表 */}
      <div className="flex flex-col gap-4" aria-live="polite">
        {messages.length === 0 && (
          <p className="rounded-lg border border-dashed border-zinc-300 px-3 py-4 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
            先在「1. 文档入库」入库，再在这里提问，例如：什么是 overlap？
          </p>
        )}

        {messages.map((m) => {
          const isUser = m.role === "user";
          const text = (m.parts ?? [])
            .filter((p) => p.type === "text")
            .map((p) => (p as { text?: string }).text ?? "")
            .join("");
          if (!text) return null;

          return (
            <div
              key={m.id}  
              className={
                isUser
                  ? "self-end max-w-[85%] rounded-xl bg-zinc-100 px-3 py-2 text-sm leading-6 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "self-start max-w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-950"
              }
            >
              <AssistantMarkdown text={text} />
            </div>
          );
        })}
      </div>

      {/* 引用来源（挂在最后一条助手消息上） */}
      {sources.length > 0 && (
        <details className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-900 dark:bg-amber-950/40">
          <summary className="cursor-pointer text-xs font-medium text-amber-800 select-none dark:text-amber-300">
            引用来源 · {sources.length} 段材料
          </summary>
          <ul className="mt-2 flex flex-col gap-2">
            {sources.map((s) => (
              <li key={s.id} className="text-xs leading-5">
                <div className="font-medium text-amber-800 dark:text-amber-300">
                  chunk #{s.index} · 相似度 {s.score}
                </div>
                <p className="mt-0.5 line-clamp-3 text-zinc-600 dark:text-zinc-300">
                  {s.content}
                </p>
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* 错误 */}
      {error && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          <span className="flex-1">{error.message || String(error)}</span>
          <button
            type="button"
            onClick={() => clearError()}
            className="text-xs font-medium underline underline-offset-2"
          >
            清除
          </button>
          {messages.length > 0 && (
            <button
              type="button"
              onClick={() => void regenerate()}
              className="text-xs font-medium underline underline-offset-2"
            >
              重试
            </button>
          )}
        </div>
      )}

      {/* 输入区 */}
      <div className="flex items-end gap-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          rows={2}
          placeholder="输入问题，回车发送…"
          className="min-h-11 w-full resize-none rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm leading-6 outline-none ring-zinc-400 focus:ring-2 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
        />
        {isStreaming ? (
          <button
            type="button"
            onClick={() => stop()}
            className="min-h-11 shrink-0 rounded-lg bg-red-600 px-4 text-sm font-medium text-white enabled:active:opacity-80 dark:bg-red-500 dark:text-zinc-950"
          >
            停止
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSend}
            disabled={!input.trim()}
            className="min-h-11 shrink-0 rounded-lg bg-sky-700 px-4 text-sm font-medium text-white enabled:active:opacity-80 disabled:opacity-40 dark:bg-sky-500 dark:text-zinc-950"
          >
            发送
          </button>
        )}
      </div>

      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        状态：{status} {isStreaming ? "· 生成中可点停止" : ""}
      </p>
    </section>
  );
}
