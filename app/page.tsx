"use client";

import { useCallback, useEffect, useState } from "react";
import { RagChat } from "@/components/RagChat";
import type { TextChunk } from "@/lib/chunking";

type ChunkResponse = {
  count: number;
  chunkSize: number;
  overlap: number;
  chunks: TextChunk[];
};

type IngestResponse = {
  ok: boolean;
  ingested: number;
  totalDocuments: number;
  totalChunks: number;
  chunkSize: number;
  overlap: number;
  model: string;
  embeddingDims: number;
  storage: string;
  preview: {
    id: string;
    index: number;
    chars: number;
    embeddingDims: number;
    contentPreview: string;
  }[];
  error?: string;
};

type RetrieveHit = {
  id: string;
  index: number;
  score: number;
  content: string;
};

type RetrieveResponse = {
  ok: boolean;
  query: string;
  topK: number;
  totalDocuments: number;
  totalChunks: number;
  model: string;
  storage: string;
  hits: RetrieveHit[];
  error?: string;
};

type StoredDocument = {
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

type DocumentsResponse = {
  ok: boolean;
  storage: string;
  documents: StoredDocument[];
  stats: { documents: number; chunks: number };
  error?: string;
};

const SAMPLE = `RAG（Retrieval-Augmented Generation，检索增强生成）是一种把「私有知识检索」和「大模型生成」串起来的做法。

相对把整份长文档一次性塞进提示词：分块后按语义检索，更省上下文，也更容易在回答里附上出处，减轻模型胡编。

典型链路是：上传文档 → 解析 → 分块（Chunking）→ Embedding 向量化 → 写入向量库；用户提问时同样 Embedding，再向量检索 topK 相关块，把材料拼进 Prompt，最后流式生成，并展示引用。

分块太大，一块噪声多、检索不准；太小，语义被撕碎、引用零碎。overlap（重叠）用来降低答案刚好落在切割缝上的风险。

本页支持：分块预览、入库（Embedding → Postgres pgvector）、检索 topK（余弦相似度）、流式问答与引用展示。

你可以改 chunkSize、overlap：先「入库」，再在下方输入问题做「检索 topK」或「流式问答」。`;

export default function HomePage() {
  const [text, setText] = useState(SAMPLE);
  const [docTitle, setDocTitle] = useState("");
  const [chunkSize, setChunkSize] = useState(200);
  const [overlap, setOverlap] = useState(40);
  const [query, setQuery] = useState("什么是 RAG？为什么要分块？");
  const [topK, setTopK] = useState(3);
  const [loading, setLoading] = useState<
    "chunk" | "ingest" | "retrieve" | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [chunkResult, setChunkResult] = useState<ChunkResponse | null>(null);
  const [ingestResult, setIngestResult] = useState<IngestResponse | null>(null);
  const [retrieveResult, setRetrieveResult] =
    useState<RetrieveResponse | null>(null);
  const [documents, setDocuments] = useState<StoredDocument[]>([]);
  const [stats, setStats] = useState<{ documents: number; chunks: number }>({
    documents: 0,
    chunks: 0,
  });
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const busy = loading !== null;

  const refreshDocuments = useCallback(async () => {
    try {
      const res = await fetch("/api/documents");
      const data = (await res.json()) as DocumentsResponse;
      if (res.ok && data.ok) {
        setDocuments(data.documents);
        setStats(data.stats);
      }
    } catch {
      // 数据库未就绪时不打扰用户，仅保留旧数据
    }
  }, []);

  useEffect(() => {
    void refreshDocuments();
  }, [refreshDocuments]);

  const runDelete = async (id: string) => {
    if (!window.confirm("确认删除该文档？其所有分块将一并删除。")) return;
    setDeletingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/documents?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      const data = (await res.json()) as DocumentsResponse & { error?: string };
      if (!res.ok) {
        setError(data.error || `删除失败（${res.status}）`);
        return;
      }
      setDocuments(data.documents ?? documents.filter((d) => d.id !== id));
      if (data.stats) setStats(data.stats);
    } catch {
      setError("删除请求失败，请确认数据库可用");
    } finally {
      setDeletingId(null);
    }
  };

  const runChunk = async () => {
    setLoading("chunk");
    setError(null);
    setIngestResult(null);
    try {
      const res = await fetch("/api/chunk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, chunkSize, overlap }),
      });
      const data = (await res.json()) as ChunkResponse & { error?: string };
      if (!res.ok) {
        setChunkResult(null);
        setError(data.error || `请求失败（${res.status}）`);
        return;
      }
      setChunkResult(data);
    } catch {
      setChunkResult(null);
      setError("网络或服务异常，请用 http://localhost:3000 打开并确认已 npm run dev");
    } finally {
      setLoading(null);
    }
  };

  const runIngest = async () => {
    setLoading("ingest");
    setError(null);
    try {
      const res = await fetch("/api/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, title: docTitle, chunkSize, overlap }),
      });
      const data = (await res.json()) as IngestResponse & { error?: string };
      if (!res.ok) {
        setIngestResult(null);
        setError(data.error || `入库失败（${res.status}）`);
        return;
      }
      setIngestResult(data);
      void refreshDocuments();
    } catch {
      setIngestResult(null);
      setError(
        "网络或服务异常。请用 http://localhost:3000，并确认 .env.local 已配齐 EMBEDDING_API_KEY + DATABASE_URL + BASE_URL + MODEL",
      );
    } finally {
      setLoading(null);
    }
  };

  const runRetrieve = async () => {
    setLoading("retrieve");
    setError(null);
    try {
      const res = await fetch("/api/retrieve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, topK }),
      });
      const data = (await res.json()) as RetrieveResponse & { error?: string };
      if (!res.ok) {
        setRetrieveResult(null);
        setError(data.error || `检索失败（${res.status}）`);
        return;
      }
      setRetrieveResult(data);
    } catch {
      setRetrieveResult(null);
      setError("检索请求失败，请确认已先入库且 Embedding 配置正确");
    } finally {
      setLoading(null);
    }
  };

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8 pb-16">
      <header className="space-y-2">
        <p className="text-sm text-zinc-500">
          02-rag-kb · P1 分块 · P2 入库 · P3 检索 · P4 问答 · P5 pgvector
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          知识库 RAG
        </h1>
        <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          入库到 <code className="text-xs">Postgres + pgvector</code>
          ，提问做向量检索与流式问答。存储由 JSON 升级为数据库（P5）。
        </p>
      </header>

      <section className="space-y-3" aria-labelledby="input-heading">
        <h2
          id="input-heading"
          className="text-sm font-medium text-zinc-800 dark:text-zinc-200"
        >
          1. 文档入库
        </h2>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={10}
          className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm leading-6 text-zinc-900 outline-none ring-zinc-400 focus:ring-2 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
          placeholder="粘贴 TXT / Markdown 正文…"
          disabled={busy}
        />
        <div className="flex flex-wrap items-end gap-3">
          <input
            value={docTitle}
            onChange={(e) => setDocTitle(e.target.value)}
            disabled={busy}
            placeholder="文档标题（可选，默认自动生成）"
            className="min-h-10 w-full rounded-lg border border-zinc-300 bg-white px-3 text-sm outline-none ring-zinc-400 focus:ring-2 dark:border-zinc-700 dark:bg-zinc-950"
          />
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs text-zinc-600 dark:text-zinc-400">
            chunkSize
            <input
              type="number"
              min={50}
              value={chunkSize}
              disabled={busy}
              onChange={(e) => setChunkSize(Number(e.target.value))}
              className="min-h-10 w-28 rounded-lg border border-zinc-300 bg-white px-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-zinc-600 dark:text-zinc-400">
            overlap
            <input
              type="number"
              min={0}
              value={overlap}
              disabled={busy}
              onChange={(e) => setOverlap(Number(e.target.value))}
              className="min-h-10 w-28 rounded-lg border border-zinc-300 bg-white px-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
            />
          </label>
          <button
            type="button"
            onClick={() => void runChunk()}
            disabled={busy || text.trim().length === 0}
            className="min-h-10 rounded-lg border border-zinc-300 bg-white px-4 text-sm font-medium text-zinc-900 enabled:active:opacity-80 disabled:opacity-40 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
          >
            {loading === "chunk" ? "分块中…" : "开始分块"}
          </button>
          <button
            type="button"
            onClick={() => void runIngest()}
            disabled={busy || text.trim().length === 0}
            className="min-h-10 rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white enabled:active:opacity-80 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
          >
            {loading === "ingest" ? "入库中…" : "入库（Embedding）"}
          </button>
        </div>
      </section>

      {/* 文档管理（P5） */}
      <section className="space-y-3" aria-labelledby="docs-heading">
        <div className="flex items-center justify-between">
          <h2
            id="docs-heading"
            className="text-sm font-medium text-zinc-800 dark:text-zinc-200"
          >
            2. 文档管理（pgvector）
          </h2>
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            {stats.documents} 个文档 · {stats.chunks} 个分块
          </span>
        </div>
        {documents.length === 0 ? (
          <p className="rounded-lg border border-dashed border-zinc-300 px-3 py-3 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
            暂无文档，先在「1. 文档入库」入库一份
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {documents.map((doc) => (
              <li
                key={doc.id}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-950"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-zinc-800 dark:text-zinc-100">
                    {doc.title || doc.id}
                  </div>
                  <div className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                    {doc.chunkCount} 块 · size={doc.chunkSize} /
                    overlap={doc.overlap} · {doc.embeddingDims} 维 ·{" "}
                    {new Date(doc.createdAt).toLocaleString()}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void runDelete(doc.id)}
                  disabled={deletingId === doc.id}
                  className="min-h-8 shrink-0 rounded-lg border border-red-200 px-3 text-xs font-medium text-red-600 enabled:active:opacity-80 disabled:opacity-40 dark:border-red-900 dark:text-red-400"
                >
                  {deletingId === doc.id ? "删除中…" : "删除"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3" aria-labelledby="retrieve-heading">
        <h2
          id="retrieve-heading"
          className="text-sm font-medium text-zinc-800 dark:text-zinc-200"
        >
          3. 检索 topK
        </h2>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={busy}
          placeholder="输入问题，例如：什么是 overlap？"
          className="min-h-11 w-full rounded-lg border border-zinc-300 bg-white px-3 text-sm outline-none ring-zinc-400 focus:ring-2 dark:border-zinc-700 dark:bg-zinc-950"
        />
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs text-zinc-600 dark:text-zinc-400">
            topK
            <input
              type="number"
              min={1}
              max={20}
              value={topK}
              disabled={busy}
              onChange={(e) => setTopK(Number(e.target.value))}
              className="min-h-10 w-28 rounded-lg border border-zinc-300 bg-white px-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
            />
          </label>
          <button
            type="button"
            onClick={() => void runRetrieve()}
            disabled={busy || query.trim().length === 0}
            className="min-h-10 rounded-lg bg-emerald-700 px-4 text-sm font-medium text-white enabled:active:opacity-80 disabled:opacity-40 dark:bg-emerald-500 dark:text-zinc-950"
          >
            {loading === "retrieve" ? "检索中…" : "检索 topK"}
          </button>
        </div>
      </section>

      <RagChat />

      {error && (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
        >
          {error}
        </p>
      )}

      {retrieveResult && (
        <section className="space-y-3" aria-live="polite">
          <h2 className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
            检索结果：top{retrieveResult.topK} · 库内{" "}
            {retrieveResult.totalChunks} 块 / {retrieveResult.totalDocuments}{" "}
            文档 · {retrieveResult.storage}
          </h2>
          <ul className="flex flex-col gap-3">
            {retrieveResult.hits.map((hit, i) => (
              <li
                key={hit.id}
                className="rounded-lg border border-emerald-200 bg-white px-3 py-3 dark:border-emerald-900 dark:bg-zinc-950"
              >
                <div className="mb-2 text-xs font-medium tracking-wide text-emerald-700 uppercase dark:text-emerald-400">
                  #{i + 1} · chunk {hit.index} · score {hit.score}
                </div>
                <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-6 text-zinc-800 dark:text-zinc-100">
                  {hit.content}
                </pre>
              </li>
            ))}
          </ul>
        </section>
      )}

      {ingestResult && (
        <section className="space-y-3" aria-live="polite">
          <h2 className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
            入库成功：本次 {ingestResult.ingested} 块 · 库内共{" "}
            {ingestResult.totalChunks} 块 / {ingestResult.totalDocuments}{" "}
            文档 · 维度 {ingestResult.embeddingDims} · 模型{" "}
            {ingestResult.model} · {ingestResult.storage}
          </h2>
          <ul className="flex flex-col gap-2">
            {ingestResult.preview.map((item) => (
              <li
                key={item.id}
                className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-950"
              >
                <div className="text-xs text-zinc-500">
                  #{item.index} · {item.chars} 字 · 向量 {item.embeddingDims} 维
                </div>
                <p className="mt-1 text-zinc-800 dark:text-zinc-100">
                  {item.contentPreview}
                  {item.chars > 80 ? "…" : ""}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {chunkResult && (
        <section className="space-y-3" aria-live="polite">
          <h2 className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
            分块预览：共 {chunkResult.count} 块（size={chunkResult.chunkSize},
            overlap={chunkResult.overlap}）
          </h2>
          <ul className="flex flex-col gap-3">
            {chunkResult.chunks.map((chunk) => (
              <li
                key={chunk.id}
                className="rounded-lg border border-zinc-200 bg-white px-3 py-3 dark:border-zinc-800 dark:bg-zinc-950"
              >
                <div className="mb-2 text-xs font-medium tracking-wide text-zinc-500 uppercase">
                  #{chunk.index} · {chunk.content.length} 字
                </div>
                <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-6 text-zinc-800 dark:text-zinc-100">
                  {chunk.content}
                </pre>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
