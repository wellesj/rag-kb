import { NextResponse } from "next/server";
import { deleteDocument, ensureSchema, listDocuments, getStats } from "@/lib/db";

export async function GET() {
  try {
    // 表未建（空库）时按空列表返回，不算错误
    try {
      await ensureSchema();
    } catch {
      return NextResponse.json({
        ok: true,
        storage: "pgvector",
        documents: [],
        stats: { documents: 0, chunks: 0 },
      });
    }
    const [docs, stats] = await Promise.all([listDocuments(), getStats()]);
    return NextResponse.json({
      ok: true,
      storage: "pgvector",
      documents: docs,
      stats,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "读取文档列表失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  let id: string | null = null;
  try {
    const url = new URL(req.url);
    id = url.searchParams.get("id");
  } catch {
    // fallthrough
  }

  if (!id) {
    // 兼容 body 传入 id
    try {
      const body = (await req.json()) as { id?: unknown };
      if (typeof body.id === "string") id = body.id;
    } catch {
      // fallthrough
    }
  }

  if (!id) {
    return NextResponse.json({ error: "缺少文档 id" }, { status: 400 });
  }

  try {
    try {
      await ensureSchema();
    } catch {
      return NextResponse.json({ error: "数据库尚未初始化" }, { status: 500 });
    }
    const deleted = await deleteDocument(id);
    if (!deleted) {
      return NextResponse.json({ error: "文档不存在或已删除" }, { status: 404 });
    }
    const stats = await getStats();
    return NextResponse.json({ ok: true, deletedId: id, stats });
  } catch (err) {
    const message = err instanceof Error ? err.message : "删除失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
