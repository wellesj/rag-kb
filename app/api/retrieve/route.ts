import { NextResponse } from "next/server";
import { embedTexts } from "@/lib/embed";
import {
  ensureSchema,
  getFirstEmbeddingDims,
  getStats,
  searchChunksByVector,
} from "@/lib/db";

type RetrieveBody = {
  query?: unknown;
  topK?: unknown;
};

function toPositiveInt(value: unknown, fallback: number): number {
  if (value === undefined || value === null || value === "") return fallback;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.floor(n);
}

export async function POST(req: Request) {
  let body: RetrieveBody;
  try {
    body = (await req.json()) as RetrieveBody;
  } catch {
    return NextResponse.json({ error: "请求体必须是 JSON" }, { status: 400 });
  }

  if (typeof body.query !== "string") {
    return NextResponse.json({ error: "缺少 query 字符串字段" }, { status: 400 });
  }

  const query = body.query.trim();
  if (!query) {
    return NextResponse.json({ error: "query 不能为空" }, { status: 400 });
  }

  if (query.length > 2000) {
    return NextResponse.json({ error: "query 过长（上限 2000 字）" }, { status: 413 });
  }

  const topK = toPositiveInt(body.topK, 3);
  if (topK < 1 || topK > 20) {
    return NextResponse.json({ error: "topK 需在 1～20 之间" }, { status: 400 });
  }

  let queryEmbedding: number[];
  try {
    const embeddings = await embedTexts([query]);
    queryEmbedding = embeddings[0] ?? [];
  } catch (err) {
    const message = err instanceof Error ? err.message : "查询 Embedding 失败";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  if (queryEmbedding.length === 0) {
    return NextResponse.json({ error: "查询向量为空" }, { status: 502 });
  }

  // P5：检索交给 pgvector（HNSW 近似近邻 + LIMIT topK）
  let hits;
  try {
    // 表未建（空库）时 ensureSchema 会抛错，按「知识库为空」处理
    try {
      await ensureSchema();
    } catch {
      return NextResponse.json(
        { error: "知识库为空，请先在页面「入库（Embedding）」" },
        { status: 400 },
      );
    }
    const expectedDims = await getFirstEmbeddingDims();
    if (expectedDims != null && queryEmbedding.length !== expectedDims) {
      return NextResponse.json(
        {
          error: `查询向量维度(${queryEmbedding.length})与库内(${expectedDims})不一致，请确认入库与检索使用同一 Embedding 模型`,
        },
        { status: 400 },
      );
    }
    hits = await searchChunksByVector(queryEmbedding, topK);
  } catch (err) {
    const message = err instanceof Error ? err.message : "数据库检索失败";
    return NextResponse.json(
      { error: `pgvector 检索失败：${message}` },
      { status: 500 },
    );
  }

  const stats = await getStats().catch(() => ({ documents: 0, chunks: 0 }));

  return NextResponse.json({
    ok: true,
    query,
    topK,
    totalDocuments: stats.documents,
    totalChunks: stats.chunks,
    storage: "pgvector",
    hits: hits.map((h) => ({
      id: h.id,
      index: h.index,
      score: Number(h.score.toFixed(6)),
      content: h.content,
    })),
  });
}
