import { NextResponse } from "next/server";
import { chunkText } from "@/lib/chunking";
import { embedTexts, getEmbeddingModelLabel } from "@/lib/embed";
import {
  ensureSchema,
  getStats,
  insertDocumentWithChunks,
} from "@/lib/db";

type IngestBody = {
  text?: unknown;
  title?: unknown;
  chunkSize?: unknown;
  overlap?: unknown;
};

function toPositiveInt(value: unknown, fallback: number): number {
  if (value === undefined || value === null || value === "") return fallback;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.floor(n);
}

export async function POST(req: Request) {
  let body: IngestBody;
  try {
    body = (await req.json()) as IngestBody;
  } catch {
    return NextResponse.json({ error: "请求体必须是 JSON" }, { status: 400 });
  }

  if (typeof body.text !== "string") {
    return NextResponse.json({ error: "缺少 text 字符串字段" }, { status: 400 });
  }

  const text = body.text.trim();
  if (!text) {
    return NextResponse.json({ error: "text 不能为空" }, { status: 400 });
  }

  if (text.length > 100_000) {
    return NextResponse.json(
      { error: "单次入库文本过长（上限约 10 万字符），请拆分后再试" },
      { status: 413 },
    );
  }

  const chunkSize = toPositiveInt(body.chunkSize, 500);
  const overlap = toPositiveInt(body.overlap, 50);

  let chunks;
  try {
    chunks = chunkText(text, { chunkSize, overlap });
  } catch (err) {
    const message = err instanceof Error ? err.message : "分块失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  if (chunks.length === 0) {
    return NextResponse.json({ error: "分块结果为空" }, { status: 400 });
  }

  let embeddings: number[][];
  let model: string;
  try {
    model = getEmbeddingModelLabel();
    embeddings = await embedTexts(chunks.map((c) => c.content));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Embedding 调用失败";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  if (embeddings.length !== chunks.length) {
    return NextResponse.json(
      { error: "Embedding 数量与分块数量不一致" },
      { status: 502 },
    );
  }

  const dims = embeddings[0]?.length ?? 0;

  // P5：写入 Postgres + pgvector
  let inserted: number;
  try {
    await ensureSchema(dims);
    const docId =
      body.title && typeof body.title === "string"
        ? body.title.trim()
        : `doc-${Date.now().toString(36)}`;
    const now = Date.now();
    inserted = await insertDocumentWithChunks(
      {
        id: docId,
        title: docId,
        source: body.title && typeof body.title === "string" ? body.title.trim() : "",
        chunkSize,
        overlap,
        model,
        embeddingDims: dims,
        createdAt: now,
      },
      chunks.map((chunk, i) => ({
        id: chunk.id,
        index: chunk.index,
        content: chunk.content,
        embedding: embeddings[i],
        createdAt: now,
      })),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "写入数据库失败";
    return NextResponse.json(
      { error: `写入 pgvector 失败：${message}` },
      { status: 500 },
    );
  }

  const stats = await getStats().catch(() => ({ documents: 0, chunks: 0 }));

  return NextResponse.json({
    ok: true,
    ingested: inserted,
    totalDocuments: stats.documents,
    totalChunks: stats.chunks,
    chunkSize,
    overlap,
    model,
    embeddingDims: dims,
    storage: "pgvector",
    preview: chunks.slice(0, 5).map((c, i) => ({
      id: c.id,
      index: c.index,
      chars: c.content.length,
      embeddingDims: dims,
      contentPreview: c.content.slice(0, 80),
    })),
  });
}
