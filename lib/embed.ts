import { createOpenAI } from "@ai-sdk/openai";
import { embedMany } from "ai";

/**
 * Embedding 走 OpenAI 兼容接口（DeepSeek 聊天 API 本身不提供 Embedding）。
 * 可用：OpenAI 官方，或硅基流动等兼容网关（改 BASE_URL + MODEL）。
 */
function getEmbeddingClient() {
  const apiKey = process.env.EMBEDDING_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "缺少 EMBEDDING_API_KEY。请在 02-rag-kb/.env.local 配置（不要用 NEXT_PUBLIC_）",
    );
  }

  return createOpenAI({
    apiKey,
    baseURL: process.env.EMBEDDING_BASE_URL?.trim() || undefined,
  });
}

function getEmbeddingModelId(): string {
  return process.env.EMBEDDING_MODEL?.trim() || "text-embedding-3-small";
}

/** 批量文本 → 向量；空数组直接返回 */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const client = getEmbeddingClient();
  const model = client.embedding(getEmbeddingModelId());

  // 避免单次请求过大，按批调用
  const batchSize = 32;
  const all: number[][] = [];

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const { embeddings } = await embedMany({
      model,
      values: batch,
    });
    all.push(...embeddings);
  }

  return all;
}

export function getEmbeddingModelLabel(): string {
  return getEmbeddingModelId();
}
