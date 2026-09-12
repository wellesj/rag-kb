import type { StoredChunk } from "@/lib/store";

export type ScoredChunk = {
  id: string;
  index: number;
  content: string;
  score: number;
};

/** 余弦相似度：越接近 1 越相似；零向量返回 0 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * 用查询向量在已入库 chunks 中取 topK（按相似度降序）。
 * P3 在内存扫 JSON；P5 可换成 pgvector 近似检索，接口形状可不变。
 */
export function rankBySimilarity(
  queryEmbedding: number[],
  chunks: StoredChunk[],
  topK: number,
): ScoredChunk[] {
  const k = Math.max(1, Math.min(topK, chunks.length || 1));

  const scored = chunks
    .map((chunk) => ({
      id: chunk.id,
      index: chunk.index,
      content: chunk.content,
      score: cosineSimilarity(queryEmbedding, chunk.embedding),
    }))
    .sort((x, y) => y.score - x.score);

  return scored.slice(0, Math.min(k, scored.length));
}
