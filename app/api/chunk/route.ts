import { NextResponse } from "next/server";
import { chunkText } from "@/lib/chunking";

type ChunkBody = {
  text?: unknown;
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
  let body: ChunkBody;
  try {
    body = (await req.json()) as ChunkBody;
  } catch {
    return NextResponse.json({ error: "请求体必须是 JSON" }, { status: 400 });
  }

  if (typeof body.text !== "string") {
    return NextResponse.json({ error: "缺少 text 字符串字段" }, { status: 400 });
  }

  if (body.text.trim().length === 0) {
    return NextResponse.json({ error: "text 不能为空" }, { status: 400 });
  }

  if (body.text.length > 200_000) {
    return NextResponse.json(
      { error: "单次文本过长（上限约 20 万字符），请先截断或拆分上传" },
      { status: 413 },
    );
  }

  const chunkSize = toPositiveInt(body.chunkSize, 500);
  const overlap = toPositiveInt(body.overlap, 50);

  try {
    const chunks = chunkText(body.text, { chunkSize, overlap });
    return NextResponse.json({
      count: chunks.length,
      chunkSize,
      overlap,
      chunks,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "分块失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
