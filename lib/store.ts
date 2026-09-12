import { promises as fs } from "fs";
import path from "path";

export type StoredChunk = {
  id: string;
  index: number;
  content: string;
  embedding: number[];
  createdAt: number;
};

export type VectorStoreFile = {
  version: 1;
  updatedAt: number;
  model: string;
  chunks: StoredChunk[];
};

const STORE_PATH = path.join(process.cwd(), "data", "store.json");

async function ensureStoreFile(): Promise<void> {
  const dir = path.dirname(STORE_PATH);
  await fs.mkdir(dir, { recursive: true });
  try {
    await fs.access(STORE_PATH);
  } catch {
    const empty: VectorStoreFile = {
      version: 1,
      updatedAt: Date.now(),
      model: "",
      chunks: [],
    };
    await fs.writeFile(STORE_PATH, JSON.stringify(empty, null, 2), "utf8");
  }
}

export async function loadStore(): Promise<VectorStoreFile> {
  await ensureStoreFile();
  const raw = await fs.readFile(STORE_PATH, "utf8");
  try {
    const parsed = JSON.parse(raw) as VectorStoreFile;
    if (!parsed || !Array.isArray(parsed.chunks)) {
      return { version: 1, updatedAt: Date.now(), model: "", chunks: [] };
    }
    return parsed;
  } catch {
    return { version: 1, updatedAt: Date.now(), model: "", chunks: [] };
  }
}

export async function saveStore(store: VectorStoreFile): Promise<void> {
  await ensureStoreFile();
  const next: VectorStoreFile = {
    ...store,
    version: 1,
    updatedAt: Date.now(),
  };
  await fs.writeFile(STORE_PATH, JSON.stringify(next, null, 2), "utf8");
}

/** 追加写入若干块（不覆盖历史；同 id 则替换） */
export async function appendChunks(
  chunks: StoredChunk[],
  model: string,
): Promise<VectorStoreFile> {
  const store = await loadStore();
  const byId = new Map(store.chunks.map((c) => [c.id, c]));
  for (const chunk of chunks) {
    byId.set(chunk.id, chunk);
  }
  const next: VectorStoreFile = {
    version: 1,
    updatedAt: Date.now(),
    model: model || store.model,
    chunks: Array.from(byId.values()),
  };
  await saveStore(next);
  return next;
}

export function getStorePath(): string {
  return STORE_PATH;
}
