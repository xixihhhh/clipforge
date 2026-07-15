# syntax=docker/dockerfile:1
# ClipForge 自托管镜像：Next standalone + Debian 发行版 ffmpeg + 内置中文字体，数据落 /data 卷。
# 一键自托管：
#   docker run -d -p 3000:3000 -v clipforge-data:/data ghcr.io/xixihhhh/clipforge:latest
# 然后浏览器打开 http://localhost:3000 —— 免 Key 即可出片（免费素材 + Edge TTS）。

# apt 源域名可通过 --build-arg APT_MIRROR=mirrors.aliyun.com 覆盖（国内构建更快更稳），默认官方源。
# 保持 http：apt 有 GPG 签名校验完整性，而 bookworm-slim 无 ca-certificates，改 https 反而会挂。
ARG APT_MIRROR=deb.debian.org

# ---- 构建阶段 ----
FROM node:22-bookworm-slim AS builder
ARG APT_MIRROR
WORKDIR /app
RUN sed -i "s|deb.debian.org|${APT_MIRROR}|g" /etc/apt/sources.list.d/debian.sources
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

# ---- 运行阶段 ----
FROM node:22-bookworm-slim AS runner
ARG APT_MIRROR
WORKDIR /app
ENV NODE_ENV=production
# ffmpeg/ffprobe 用 Debian 发行版包（app 无 FFMPEG_PATH 时回退到 PATH 里的 ffmpeg）。
# 不能用 npm 包 ffmpeg-static 的 linux 静态二进制：johnvansickle 的 FFmpeg 7.x 构建缺 harfbuzz，
# drawtext 滤镜整个不存在（No such filter: 'drawtext'），而烧字幕/价格贴/封面/图文卡/片尾卡全依赖
# drawtext——用它会让 Docker 部署凡带文字的合成必挂。Debian 构建带 harfbuzz/freetype/fontconfig，
# 合成管线所用滤镜（drawtext/xfade/zoompan/subtitles/ass/loudnorm 等）齐全。
# 中文字体无需系统包：内置 public/fonts/subtitle.otf 且 resolveChineseFontFile 优先用它。
RUN sed -i "s|deb.debian.org|${APT_MIRROR}|g" /etc/apt/sources.list.d/debian.sources \
  && apt-get update && apt-get install -y --no-install-recommends -o Acquire::Retries=5 ffmpeg \
  && rm -rf /var/lib/apt/lists/* \
  && ffmpeg -hide_banner -filters 2>/dev/null | grep -q ' drawtext ' \
  || (echo "FATAL: ffmpeg lacks the drawtext filter — subtitle/text composition would break" && exit 1)
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
