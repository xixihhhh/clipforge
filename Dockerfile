# syntax=docker/dockerfile:1
# ClipForge 自托管镜像：Next standalone + 静态 ffmpeg(来自 npm 依赖) + 内置中文字体，数据落 /data 卷。
# 一键自托管：
#   docker run -d -p 3000:3000 -v clipforge-data:/data ghcr.io/xixihhhh/clipforge:latest
# 然后浏览器打开 http://localhost:3000 —— 免 Key 即可出片（免费素材 + Edge TTS）。

# ---- 构建阶段 ----
FROM node:22-bookworm-slim AS builder
WORKDIR /app
# better-sqlite3 是原生模块，需要编译工具链（-o Acquire::Retries 兜底镜像源偶发 5xx）
RUN apt-get update && apt-get install -y --no-install-recommends -o Acquire::Retries=5 python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
# 容器只跑 web，跳过 Electron 二进制下载，加快安装
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build
# 取出 ffmpeg-static / @ffprobe-installer 的静态二进制（项目已依赖），
# 运行阶段直接用，避免 apt 装 ffmpeg —— 镜像更可移植，且不受构建网络/代理影响。
RUN node -e "require('fs').copyFileSync(require('ffmpeg-static'),'/ffmpeg')" \
  && node -e "require('fs').copyFileSync(require('@ffprobe-installer/ffprobe').path,'/ffprobe')" \
  && chmod +x /ffmpeg /ffprobe

# ---- 运行阶段 ----
FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
# 静态 ffmpeg/ffprobe（来自 npm 依赖，无需 apt；app 无 FFMPEG_PATH 时回退到 PATH 里的 ffmpeg）。
# 中文字体也无需系统包：内置 public/fonts/subtitle.otf 且 resolveChineseFontFile 优先用它。
COPY --from=builder /ffmpeg /usr/local/bin/ffmpeg
COPY --from=builder /ffprobe /usr/local/bin/ffprobe
# Next standalone 产物（含最小 server.js + 必要 node_modules，含外部化的 better-sqlite3）
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
# drizzle 迁移（运行时读取，nft 不追踪，需显式带上）
COPY --from=builder /app/drizzle ./drizzle
# 数据（sqlite + uploads + output）落可写卷，便于持久化
ENV APP_DATA_DIR=/data
RUN mkdir -p /data
VOLUME /data
ENV PORT=3000 HOSTNAME=0.0.0.0
EXPOSE 3000
CMD ["node", "server.js"]
