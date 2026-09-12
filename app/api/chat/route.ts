import { deepSeek } from "@ai-sdk/deepseek";
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  streamText,
  toUIMessageStream,
  type UIMessage,
} from "ai";
import { embedTexts } from "@/lib/embed";
import {
  ensureSchema,
  getFirstEmbeddingDims,
  searchChunksByVector,
} from "@/lib/db";

export const maxDuration = 60;

type ChatBody = {
  messages?: unknown;
  topK?: unknown;
};

function toPositiveInt(value: unknown, fallback: number): number {
  if (value === undefined || value === null || value === "") return fallback;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.floor(n);
}

/** 从一条 UIMessage 中取出纯文本（用户消息的 text parts 拼接） */
function extractUserText(message: UIMessage | undefined): string {
  if (!message) return "";
  return (message.parts ?? [])
    .filter((p) => p.type === "text")
    .map((p) => (p as { text?: string }).text ?? "")
    .join("")
    .trim();
}

export async function POST(req: Request) {
  if (!process.env.DEEPSEEK_API_KEY) {
    return Response.json(
      { error: "缺少 DEEPSEEK_API_KEY，请在 .env.local 配置（P4 问答用，可复用 01-chatbot 的 Key）" },
      { status: 500 },
    );
  }

  let body: ChatBody;
  try {
    body = (await req.json()) as ChatBody;
  } catch {
    return Response.json({ error: "请求体必须是 JSON" }, { status: 400 });
  }

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return Response.json({ error: "缺少 messages 数组" }, { status: 400 });
  }

  const messages = body.messages as UIMessage[];

  // 取最后一条用户消息作为检索 query（支持多轮：始终以最近问题为准）
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const query = extractUserText(lastUser);
  if (!query) {
    return Response.json({ error: "没有可检索的用户消息文本" }, { status: 400 });
  }
  if (query.length > 2000) {
    return Response.json({ error: "问题过长（上限 2000 字）" }, { status: 413 });
  }

  const topK = toPositiveInt(body.topK, 3);
  if (topK < 1 || topK > 20) {
    return Response.json({ error: "topK 需在 1～20 之间" }, { status: 400 });
  }

  // 1. 检索：问题 Embedding → pgvector 余弦距离 topK
  let queryEmbedding: number[];
  try {
    const embeddings = await embedTexts([query]);
    queryEmbedding = embeddings[0] ?? [];
  } catch (err) {
    const message = err instanceof Error ? err.message : "查询 Embedding 失败";
    return Response.json({ error: message }, { status: 502 });
  }
  if (queryEmbedding.length === 0) {
    return Response.json({ error: "查询向量为空" }, { status: 502 });
  }

  let hits;
  try {
    // 表未建（空库）时 ensureSchema 会抛错，按「知识库为空」处理
    try {
      await ensureSchema();
    } catch {
      return Response.json(
        { error: "知识库为空，请先在页面「入库（Embedding）」再提问" },
        { status: 400 },
      );
    }
    const expectedDims = await getFirstEmbeddingDims();
    if (expectedDims == null) {
      return Response.json(
        { error: "知识库为空，请先在页面「入库（Embedding）」再提问" },
        { status: 400 },
      );
    }
    if (queryEmbedding.length !== expectedDims) {
      return Response.json(
        {
          error: `查询向量维度(${queryEmbedding.length})与库内(${expectedDims})不一致，请确认入库与检索使用同一 Embedding 模型`,
        },
        { status: 400 },
      );
    }
    hits = await searchChunksByVector(queryEmbedding, topK);
  } catch (err) {
    const message = err instanceof Error ? err.message : "数据库检索失败";
    return Response.json(
      { error: `pgvector 检索失败：${message}` },
      { status: 500 },
    );
  }

  // 2. 拼 Prompt：只根据检索到的材料回答
  const context = hits
    .map(
      (h, i) =>
        `【引用 ${i + 1}】（chunk #${h.index}，相似度 ${h.score.toFixed(3)}）\n${h.content}`,
    )
    .join("\n\n");

  const system = [
    "你是一个基于私有知识库回答问题的助手。",
    "请严格根据下面提供的【参考资料】回答用户问题：",
    "- 只使用参考资料中的信息；资料里没有的内容，明确回答「资料中没有相关内容」，不要编造。",
    "- 回答尽量简洁、准确，直接给结论。",
    "- 可以在回答末尾用 [1][2] 标注信息来自哪份引用（对应下面的【引用 N】编号）。",
    "",
    "【参考资料】",
    context,
  ].join("\n");

  // 3. 流式生成（DeepSeek 聊天）
  const modelId =
    process.env.DEEPSEEK_MODEL === "deepseek-v4-pro"
      ? "deepseek-v4-pro"
      : "deepseek-v4-flash";

  const result = streamText({
    model: deepSeek(modelId),
    system,
    messages: await convertToModelMessages(messages),
    // 前端 useChat.stop() abort 本次请求，服务端接到模型调用上以节省 Token
    abortSignal: req.signal,
    onAbort: () => {
      console.log("[rag/chat] stream aborted by client");
    },
  });

  // 4. 引用数据作为 data part 随 UI message stream 回传（前端从 message.parts 读取）
  const sources = hits.map((h) => ({
    id: h.id,
    index: h.index,
    score: Number(h.score.toFixed(6)),
    content: h.content,
  }));

  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      writer.write({
        type: "data-sources",
        data: sources,
      } as never);
      writer.merge(
        toUIMessageStream({
          stream: result.stream,
          onError: (error) => {
            if (error == null) return "未知错误";
            if (typeof error === "string") return error;
            if (error instanceof Error) return error.message;
            return "生成失败，请稍后重试";
          },
        }),
      );
    },
  });

  return createUIMessageStreamResponse({ stream });
}
