# 02-rag-kb 部署文档（P6）

> 目标：一条命令在云服务器上把「Next.js + pgvector + Nginx」跑起来，公网可演示。  
> 关键：**SSE 流式必须关 Nginx buffering**（`proxy_buffering off`），否则 AI 回答一次性吐出，体验断裂。

## 架构图

```text
浏览器
  │ http://IP:8081
  ▼
Nginx（反代）
  │ proxy_pass http://web:3000
  │ proxy_buffering off（SSE 关键）
  │ proxy_read_timeout 300s
  ▼
web（Next.js standalone，容器内 :3000）
  │ 同 Compose 内网
  ├─→ POST /api/ingest|retrieve|chat   （DEEPSEEK / EMBEDDING 密钥在容器环境变量）
  │
  └─→ db（pgvector，容器内 :5432，不对公网）
        └─ volume rag-kb-pgdata（数据持久化）
```

- **db 不映射任何宿主端口** → 公网无法直连数据库
- **web 不映射宿主端口** → 只经 Nginx 反代
- **Nginx 映射宿主 8081**（80 通常已被 ChatBot 占用；有域名/证书再加 443）

> 完整傻瓜式部署见仓库根目录 `云服务器部署完整指南.md`。

## 部署步骤（云服务器 Ubuntu / CentOS + Docker）

### 0. 前置：服务器装好 Docker + Compose 插件

```bash
# Ubuntu 示例（CentOS 类似，参考官方文档）
curl -fsSL https://get.docker.com | sh
sudo systemctl enable --now docker
docker compose version   # 应显示 v2.x
```

### 1. 上传代码

```bash
# 方式 A：git clone（推荐）
git clone <你的仓库地址> 02-rag-kb && cd 02-rag-kb

# 方式 B：scp 上传目录
# 本机执行： scp -r D:\AI\AI应用前端向\02-rag-kb user@IP:/opt/rag-kb
```

### 2. 配置密钥（不进 Git）

```bash
cd /opt/rag-kb
cp .env.production.example .env.production
vim .env.production   # 填真实 Key：POSTGRES_PASSWORD / EMBEDDING_API_KEY / DEEPSEEK_API_KEY
                      # 国内网络拉不动官方镜像时，再取消注释 PGVECTOR_IMAGE / NGINX_IMAGE（1ms 源）
chmod 600 .env.production
```

### 3. 构建并启动

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

### 4. 验证

```bash
docker compose -f docker-compose.prod.yml ps          # 三个服务都 healthy/up
curl http://127.0.0.1/api/documents                   # 页面/接口通
curl -N http://127.0.0.1/api/chat -H 'Content-Type: application/json' \
  -d '{"messages":[{"id":"1","role":"user","parts":[{"type":"text","text":"测试"}]}]}' \
  | head -20                                          # 能看到 data: 增量推送
```

### 5. 安全组

- 云厂商安全组只开 **80**（及 **443**）；**不要开 5432**
- SSH 端口保持最小暴露

## 更新发布（改代码后）

```bash
cd /opt/rag-kb
git pull
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
# 数据在 volume 里，重建容器不丢
```

## 常见问题

| 现象 | 原因 / 处理 |
|------|------------|
| 页面 502 | `docker compose ps` 看 web 是否起来；`docker compose logs web` 看报错 |
| 流式像一次性吐完 | Nginx `proxy_buffering off` 没生效；确认 nginx/conf.d/rag-kb.conf 已挂载且重启过 |
| 回答中途断 | `proxy_read_timeout` 太短 → 调大到 300s；或看 `docker compose logs web` 是否报模型超时 |
| 入库报 `type "vector" does not exist` | 新库未启用 pgvector 扩展。代码里 `ensureSchema` 已加 `CREATE EXTENSION IF NOT EXISTS vector`，重建 web 镜像即可 |
| 入库报「密码认证失败」 | 生产/开发 volume 串了：prod 用 `rag-kb-prod-pgdata`，开发用 `rag-kb-pgdata`，确认两个 compose 卷名不同 |
| 入库报「维度不一致」 | Embedding 模型换过 → 需要清库重建（volume 删除后重新入库） |
| 重启后数据没了 | volume `rag-kb-prod-pgdata` 被删（`docker compose down -v` 会删）；正常 `restart` 不丢 |

## 数据库运维

```bash
# 进入 psql
docker compose -f docker-compose.prod.yml exec db psql -U rag -d rag_kb

# 备份（先演练一次）
docker compose -f docker-compose.prod.yml exec db pg_dump -U rag -d rag_kb > backup.sql

# 恢复
docker compose -f docker-compose.prod.yml exec -T db psql -U rag -d rag_kb < backup.sql
```

## HTTPS（可选，推荐）

1. 有域名后：`nginx/conf.d/rag-kb.conf` 内有完整 443 配置注释，照抄
2. 证书放 `nginx/certs/`，放开 compose 里的 443 映射
3. 或用宝塔面板的 Let's Encrypt 一键证书（若服务器是宝塔）

## 与 01-chatbot 部署的关系

- 01-chatbot 是宝塔 + PM2（单应用）；本目录是 **Docker Compose 全家桶**（web+db+nginx）
- 面试叙事：ChatBot 展示「PM2 + 反代 + SSE」；RAG 展示「容器化 + 数据库 + 内网隔离」，两条部署路径都能讲
