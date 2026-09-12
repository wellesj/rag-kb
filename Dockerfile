# P6：02-rag-kb 生产镜像（Next.js standalone + Node 22 slim）
# 构建：docker build -t rag-kb:latest .
# 运行见 docker-compose.yml（web + db 同 Compose）
#
# 基础镜像源：默认官方 Docker Hub；国内网络拉不动时可覆盖：
#   docker build --build-arg NODE_BASE=docker.1ms.run/library/node:22-alpine -t rag-kb:latest .
# 或在本机 Docker 配置 registry-mirrors 加速。

ARG NODE_BASE=node:22-alpine

# ---- 依赖安装 ----
FROM ${NODE_BASE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- 构建 ----
FROM ${NODE_BASE} AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# standalone 输出由 next.config.ts 的 output: "standalone" 控制
RUN npm run build

# ---- 运行时 ----
FROM ${NODE_BASE} AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# 非 root 运行（安全基线）
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

# standalone 产物：public/.next/static + server.js
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000
CMD ["node", "server.js"]
