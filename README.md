# 02-rag-kb · 私有知识库 RAG

> 针对**你上传的资料**做检索增强问答（不是全网搜索）。  
> 当前进度：**P1 分块 + P2 入库 + P3 检索 topK + P4 流式问答与引用 + P5 Postgres/pgvector**。  
> 尚未做：服务器上线（P6）、文档文件上传解析（当前粘贴文本入库）。

## 本地启动

```powershell
cd D:\AI\AI应用前端向\02-rag-kb
npm install
copy .env.example .env.local
# 编辑 .env.local，填入 EMBEDDING_API_KEY / DEEPSEEK_API_KEY / DATABASE_URL

# 1. 启动 Postgres + pgvector（Docker Compose）
docker compose up -d

# 2. 启动应用
npm run dev
```

打开 http://localhost:3000

- **开始分块**：只看切块（不调 Embedding）
- **入库（Embedding）**：分块 → 向量化 → 写入 Postgres（pgvector）
- **文档管理（P5）**：文档列表、分块数、删除（级联删 chunks）
- **检索 topK**：问题 Embedding → pgvector 向量查询取相关块
- **流式问答（P4）**：提问 → 服务端检索 → 拼 Prompt → DeepSeek 流式回答，引用来源随流回传

## 环境变量

| 变量 | 必填 | 说明 |
|------|------|------|
| `EMBEDDING_API_KEY` | 入库/检索必填 | Embedding 服务 Key，勿 `NEXT_PUBLIC_` |
| `EMBEDDING_BASE_URL` | 否 | 兼容网关，如硅基流动 `https://api.siliconflow.cn/v1` |
| `EMBEDDING_MODEL` | 否 | 默认 `text-embedding-3-small`；硅基流动可用 `BAAI/bge-m3` |
| `DEEPSEEK_API_KEY` | P4 问答必填 | 聊天 Key，可复用 `01-chatbot` 的 DeepSeek Key |
| `DEEPSEEK_MODEL` | 否 | 默认 `deepseek-v4-flash`，可切 `deepseek-v4-pro` |
| `DATABASE_URL` | P5 必填 | `postgres://rag:rag@localhost:5433/rag_kb`（对应 docker-compose.yml） |

> DeepSeek **聊天** API 不提供 Embedding；需 OpenAI 或 OpenAI 兼容的 Embedding 服务。  
> 问题和文档必须用**同一套 Embedding 模型**（否则向量空间不一致）。  
> 宿主端口用 **5433**：本机 5432 可能被其他项目（如 aichart-postgres）占用。

## 存储：Postgres + pgvector（P5）

```text
documents（文档）
  ├─ id / title / chunk_size / overlap / model / embedding_dims / created_at
  └─ chunks（分块，外键级联删除）
       ├─ id / document_id / idx / content / created_at
       └─ embedding vector(1024)   ← pgvector 类型
```

- 检索：`ORDER BY embedding <=> $1::vector LIMIT topK`（`<=>` 余弦距离）
- 索引：HNSW（`vector_cosine_ops`），近似最近邻，比暴力扫描快
- 持久化：Docker volume `rag-kb-pgdata`，重启容器数据不丢
- 安全：端口只绑定 `127.0.0.1`，不对公网

## 已有能力

| 路径 | 说明 |
|------|------|
| `lib/chunking.ts` | 按字符滑动窗口分块（chunkSize / overlap） |
| `lib/embed.ts` | `embedMany` 批量向量化（按 32 条一批） |
| `lib/db.ts` | **P5**：pg 连接池 + 幂等建表（vector 列 + HNSW 索引）+ 文档/块 CRUD + 向量检索 |
| `lib/store.ts` | （旧）P2~P4 的 JSON 存储，已弃用，仅保留参考 |
| `lib/retrieve.ts` | （旧）P3 内存余弦 topK，已弃用，仅保留参考 |
| `POST /api/chunk` | 仅分块预览 |
| `POST /api/ingest` | 分块 + Embedding + 写入 pgvector |
| `POST /api/retrieve` | 问题 Embedding → pgvector 向量查询 topK |
| `POST /api/chat` | **P4**：检索 topK → 拼 Prompt → `streamText` 流式回答，引用作为 data part 随流回传 |
| `GET/DELETE /api/documents` | **P5**：文档列表（含分块数）/ 删除 |
| `components/RagChat.tsx` | **P4**：useChat 流式问答 UI + 引用来源 + 停止/重试 |
| `components/AssistantMarkdown.tsx` | Markdown 安全渲染 + 代码高亮（复用 01-chatbot，无 `rehype-raw`） |
| `app/page.tsx` | 分块 / 入库 / 文档管理 / 检索 / 问答 UI |
| `docker-compose.yml` | **P5**：pgvector:pg16 容器 + volume |

## RAG 链路（面试可画）

```text
【入库】 粘贴文本 → POST /api/ingest
  → chunkText 分块 → embedTexts 向量化
  → INSERT documents + chunks（embedding vector 列，HNSW 索引）

【问答】 用户提问 → POST /api/chat
  → 最后一条用户消息 → embedTexts([query])
  → pgvector: ORDER BY embedding <=> $1 LIMIT topK   ← 数据库内近似近邻
  → 把 hits 拼进 system prompt（只根据材料回答）
  → streamText(DeepSeek) 流式生成
  → 引用 hits 作为 data-sources part 随 UI message stream 回传
  → 前端渲染回答 + 引用（可停止 / 重试）

【管理】 GET /api/documents 列表 · DELETE /api/documents?id= 级联删除
```

## 生产部署（P6，部署资产已就绪）

```text
浏览器 → Nginx(80) → web(Next.js standalone :3000) → db(pgvector，仅内网)
                      ├ proxy_buffering off（SSE 关键）
                      └ volume rag-kb-pgdata（持久化）
```

- `Dockerfile`：standalone 生产镜像（非 root，约 20MB）
- `docker-compose.prod.yml`：web + db + nginx 三服务；db 不映射宿主端口
- `nginx/conf.d/rag-kb.conf`：反代 + `proxy_buffering off` + 超时
- `deploy/README.md`：部署 / 更新 / 备份 / 排障完整文档
- 上服务器：`cp .env.production.example .env.production` 填 Key →
  `docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build`

## 下一步

- **P6 收尾**：上服务器公网演示（步骤见 `deploy/README.md`）
- 扩展：PDF/TXT 文件上传解析（pdf-parse 等）、按文档类型调分块参数

详见 `02-rag-kb-从0到1.md` 与 `RAG.md`。
