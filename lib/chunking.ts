export type TextChunk = {
  id: string;
  index: number;
  content: string;
};

export type ChunkOptions = {
  /** 每块目标字符数（按 JS 字符串长度，含中文按 1 字计） */
  chunkSize?: number;
  /** 相邻块重叠字符数，减轻切在句子中间丢上下文 */
  overlap?: number;
};

const DEFAULT_CHUNK_SIZE = 500;
const DEFAULT_OVERLAP = 50;

function createChunkId(index: number): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") {
    return c.randomUUID();
  }
  return `chunk-${index}-${Date.now().toString(36)}`;
}

/**
 * 按字符滑动窗口分块（P1 最小实现）。
 * 后续可换成按段落 / 按 token，接口保持返回 TextChunk[] 即可。
 */
export function chunkText(
  text: string,
  options: ChunkOptions = {},
): TextChunk[] {
  const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const overlap = options.overlap ?? DEFAULT_OVERLAP;

  if (!Number.isFinite(chunkSize) || chunkSize <= 0) {
    throw new Error("chunkSize 必须是正数");
  }
  if (!Number.isFinite(overlap) || overlap < 0) {
    throw new Error("overlap 不能为负数");
  }
  if (overlap >= chunkSize) {
    throw new Error("overlap 必须小于 chunkSize");
  }

  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  const chunks: TextChunk[] = [];
  let start = 0;
  let index = 0;
  const step = chunkSize - overlap;

  while (start < normalized.length) {
    const end = Math.min(start + chunkSize, normalized.length);
    const content = normalized.slice(start, end).trim();
    if (content) {
      chunks.push({
        id: createChunkId(index),
        index,
        content,
      });
      index += 1;
    }
    if (end >= normalized.length) break;
    start += step;
  }

  return chunks;
}
