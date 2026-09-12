"use client";

import { Component, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";

/** 流式时未闭合的 ``` 会导致怪异解析；展示期临时补闭合，不改原始 messages */
function stabilizeStreamingMarkdown(text: string) {
  const fenceCount = (text.match(/```/g) || []).length;
  if (fenceCount % 2 === 1) {
    return `${text}\n\`\`\``;
  }
  return text;
}

/** 禁止 javascript: 等危险协议（react-markdown 默认也不执行裸 HTML） */
function safeUrlTransform(url: string) {
  const trimmed = url.trim();
  if (!trimmed) return "#";
  if (/^(https?:|mailto:|tel:|\/|#)/i.test(trimmed)) {
    return trimmed;
  }
  return "#";
}

type BoundaryProps = {
  content: string;
  children: ReactNode;
};

type BoundaryState = { hasError: boolean };

class MarkdownErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { hasError: false };

  static getDerivedStateFromError(): BoundaryState {
    return { hasError: true };
  }

  componentDidUpdate(prevProps: BoundaryProps) {
    if (prevProps.content !== this.props.content && this.state.hasError) {
      this.setState({ hasError: false });
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <pre className="overflow-x-auto whitespace-pre-wrap break-words text-sm text-zinc-700 dark:text-zinc-200">
          {this.props.content}
        </pre>
      );
    }
    return this.props.children;
  }
}

type Props = {
  text: string;
};

export function AssistantMarkdown({ text }: Props) {
  const display = stabilizeStreamingMarkdown(text);

  return (
    <MarkdownErrorBoundary content={text}>
      <div className="assistant-md max-w-none text-sm leading-6 text-zinc-800 dark:text-zinc-100">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeHighlight]}
          urlTransform={safeUrlTransform}
          // 不使用 rehype-raw：禁止把模型输出当 HTML 执行
          components={{
            a: ({ href, children, ...props }) => (
              <a
                {...props}
                href={href}
                target="_blank"
                rel="noreferrer noopener"
                className="text-sky-700 underline underline-offset-2 dark:text-sky-400"
              >
                {children}
              </a>
            ),
            pre: ({ children, ...props }) => (
              <pre
                {...props}
                className="my-3 overflow-x-auto rounded-lg bg-zinc-900 p-3 text-[13px] leading-5 text-zinc-100"
              >
                {children}
              </pre>
            ),
            code: ({ className, children, ...props }) => {
              const isBlock = Boolean(className);
              if (isBlock) {
                return (
                  <code className={className} {...props}>
                    {children}
                  </code>
                );
              }
              return (
                <code
                  className="rounded bg-zinc-100 px-1 py-0.5 font-mono text-[0.85em] text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100"
                  {...props}
                >
                  {children}
                </code>
              );
            },
            p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
            ul: ({ children }) => (
              <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>
            ),
            ol: ({ children }) => (
              <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>
            ),
            h1: ({ children }) => (
              <h1 className="mb-2 mt-3 text-xl font-semibold">{children}</h1>
            ),
            h2: ({ children }) => (
              <h2 className="mb-2 mt-3 text-lg font-semibold">{children}</h2>
            ),
            h3: ({ children }) => (
              <h3 className="mb-1.5 mt-2 text-base font-semibold">{children}</h3>
            ),
            blockquote: ({ children }) => (
              <blockquote className="my-2 border-l-2 border-zinc-300 pl-3 text-zinc-600 dark:border-zinc-600 dark:text-zinc-300">
                {children}
              </blockquote>
            ),
            table: ({ children }) => (
              <div className="my-2 overflow-x-auto">
                <table className="min-w-full border-collapse text-left text-sm">
                  {children}
                </table>
              </div>
            ),
            th: ({ children }) => (
              <th className="border border-zinc-200 bg-zinc-50 px-2 py-1 font-medium dark:border-zinc-700 dark:bg-zinc-900">
                {children}
              </th>
            ),
            td: ({ children }) => (
              <td className="border border-zinc-200 px-2 py-1 dark:border-zinc-700">
                {children}
              </td>
            ),
          }}
        >
          {display}
        </ReactMarkdown>
      </div>
    </MarkdownErrorBoundary>
  );
}
