import { Pool, type PoolClient, type QueryResult } from "pg";

/**
 * P5：Postgres + pgvector 存储层。
 * 设计：documents（文档）+ chunks（分块，含 embedding 向量列）。
 * 检索用 pgvector 余弦距离（<=>）近似近邻（HNSW 索引）。
 */

export type StoredDocument = {
  id: string;
  title: string;
  source: string;
  chunkSize: number;
  overlap: number;
  model: string;
  embeddingDims: number;
  createdAt: number;
  chunkCount: number;
};

export type StoredChunk = {
  id: string;
  documentId: string;
  index: number;
  content: string;
  embedding: number[];
  createdAt: number;
};

export type DbSource = {
  id: string;
  documentId: string;
  index: number;
  content: string;
  score: number;
};

let pool: Pool | null = null;

function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error(
      "缺少 DATABASE_URL。P5 起需要 Postgres + pgvector，配置示例见 .env.example",
    );
  }
  return url;
}

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: getDatabaseUrl() });
    // 数据库重启/断连时避免未捕获异常（如 docker restart 场景），由业务侧按 500 处理
    pool.on("error", (err) => {
      console.error("[db] idle client error:", err.message);
    });
  }
  return pool;
}

/**
 * 幂等建表（CREATE TABLE IF NOT EXISTS + HNSW 索引）。
 * pgvector 的 vector 列必须有固定维度才能建 HNSW 索引，
 * 因此首次建表需要传入 dims（来自本次入库的 embedding 维度）。
 * 表已存在时忽略 dims（结构不变）。
 */
export async function ensureSchema(dims?: number): Promise<void> {
  const p = getPool();

  // pgvector 扩展：新库（如生产 volume 首次初始化）需先启用，幂等
  await p.query(`CREATE EXTENSION IF NOT EXISTS vector`);

  // 表已存在 → 直接建辅助索引后返回（列结构不重建）
  const tableExists = await p.query(
    `SELECT to_regclass('public.chunks') IS NOT NULL AS exists`,
  );
  if (tableExists.rows[0]?.exists) {
    await p.query(
      `CREATE INDEX IF NOT EXISTS idx_chunks_document ON chunks(document_id)`,
    );
    return;
  }

  if (!dims || dims <= 0) {
    throw new Error(
      "首次建表需要知道 embedding 维度（dims）。请先入库（ingest）触发建表。",
    );
  }

  await p.query(
    `
    CREATE TABLE IF NOT EXISTS documents (
      id            TEXT PRIMARY KEY,
      title         TEXT NOT NULL,
      source        TEXT NOT NULL DEFAULT '',
      chunk_size    INTEGER NOT NULL,
      overlap       INTEGER NOT NULL,
      model         TEXT NOT NULL DEFAULT '',
      embedding_dims INTEGER NOT NULL DEFAULT 0,
      created_at    BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chunks (
      id          TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      idx         INTEGER NOT NULL,
      content     TEXT NOT NULL,
      embedding   vector(${dims}) NOT NULL,
      created_at  BIGINT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_chunks_document ON chunks(document_id);
    CREATE INDEX IF NOT EXISTS idx_chunks_embedding_hnsw
      ON chunks USING hnsw (embedding vector_cosine_ops);
    `,
  );
}

/** 一次性插入一个文档及其所有块（事务） */
export async function insertDocumentWithChunks(
  doc: {
    id: string;
    title: string;
    source?: string;
    chunkSize: number;
    overlap: number;
    model: string;
    embeddingDims: number;
    createdAt: number;
  },
  chunks: {
    id: string;
    index: number;
    content: string;
    embedding: number[];
    createdAt: number;
  }[],
): Promise<number> {
  const p = getPool();
  const client: PoolClient = await p.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO documents (id, title, source, chunk_size, overlap, model, embedding_dims, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        doc.id,
        doc.title,
        doc.source ?? "",
        doc.chunkSize,
        doc.overlap,
        doc.model,
        doc.embeddingDims,
        doc.createdAt,
      ],
    );

    for (const c of chunks) {
      await client.query(
        `INSERT INTO chunks (id, document_id, idx, content, embedding, created_at)
         VALUES ($1, $2, $3, $4, $5::vector, $6)`,
        [
          c.id,
          doc.id,
          c.index,
          c.content,
          JSON.stringify(c.embedding),
          c.createdAt,
        ],
      );
    }

    await client.query("COMMIT");
    return chunks.length;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** 文档列表（含块数，按创建时间倒序） */
export async function listDocuments(): Promise<StoredDocument[]> {
  const p = getPool();
  const res = await p.query(
    `SELECT d.id, d.title, d.source, d.chunk_size AS "chunkSize", d.overlap,
            d.model, d.embedding_dims AS "embeddingDims", d.created_at AS "createdAt",
            COUNT(c.id)::int AS "chunkCount"
     FROM documents d
     LEFT JOIN chunks c ON c.document_id = d.id
     GROUP BY d.id
     ORDER BY d.created_at DESC`,
  );
  return res.rows;
}

/** 删除文档（chunks 级联删除） */
export async function deleteDocument(id: string): Promise<boolean> {
  const p = getPool();
  const res = await p.query("DELETE FROM documents WHERE id = $1", [id]);
  return (res.rowCount ?? 0) > 0;
}

/** 统计：总文档数、总块数 */
export async function getStats(): Promise<{ documents: number; chunks: number }> {
  const p = getPool();
  const [d, c] = await Promise.all([
    p.query("SELECT COUNT(*)::int AS n FROM documents"),
    p.query("SELECT COUNT(*)::int AS n FROM chunks"),
  ]);
  return { documents: d.rows[0].n, chunks: c.rows[0].n };
}

/**
 * 向量检索：问题向量 vs chunks.embedding 的余弦相似度。
 * pgvector 的 <=> 是余弦距离（越小越近），相似度 = 1 - 距离。
 * LIMIT topK 由数据库完成（HNSW 近似近邻）。
 */
export async function searchChunksByVector(
  queryEmbedding: number[],
  topK: number,
): Promise<DbSource[]> {
  const p = getPool();
  const res = await p.query(
    `SELECT id, document_id AS "documentId", idx AS "index", content,
            1 - (embedding <=> $1::vector) AS score
     FROM chunks
     ORDER BY embedding <=> $1::vector
     LIMIT $2`,
    [JSON.stringify(queryEmbedding), topK],
  );
  return res.rows.map((r) => ({
    id: r.id,
    documentId: r.documentId,
    index: r.index,
    content: r.content,
    score: Number(r.score),
  }));
}

/** 库内首块的向量维度（校验 Embedding 一致性用） */
export async function getFirstEmbeddingDims(): Promise<number | null> {
  const p = getPool();
  const res: QueryResult<{ dims: number | null }> = await p.query(
    `SELECT (SELECT vector_dims(embedding) FROM chunks LIMIT 1) AS dims`,
  );
  return res.rows[0]?.dims ?? null;
}
