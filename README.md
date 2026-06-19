# 带货剪手 - AI 电商短视频自动生成工具

> **AI E-commerce Video Generator** | 上传商品图，自动生成抖音/快手/小红书带货短视频

<p align="center">
  <img src="https://github.com/xixihhhh/daihuo-jianshou/actions/workflows/ci.yml/badge.svg" alt="CI" />
  <img src="https://img.shields.io/badge/Next.js-16-black?style=flat-square&logo=next.js" alt="Next.js 16" />
  <img src="https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react" alt="React 19" />
  <img src="https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript" alt="TypeScript 5" />
  <img src="https://img.shields.io/badge/Tailwind-4-06B6D4?style=flat-square&logo=tailwindcss" alt="Tailwind CSS 4" />
  <img src="https://img.shields.io/badge/FFmpeg-视频合成-007808?style=flat-square&logo=ffmpeg" alt="FFmpeg" />
  <img src="https://img.shields.io/badge/AI-多模型聚合-FF6F00?style=flat-square" alt="AI Multi-Model" />
</p>

**带货剪手**是一款面向电商卖家和短视频运营的 AI 视频生成工具。只需上传商品图片，AI 自动分析卖点、生成带货脚本、逐镜头生成素材、合成完整视频，一键导出到抖音、快手、小红书等平台。

> 🚀 **正在升级为通用 AI 短视频创作平台**：在带货之外，新增 **多源免费素材引擎**（Openverse 免 Key / Pixabay / Pexels），目标是让不懂技术的人零配置也能成片；并在推进 **Electron 一键桌面包**（Win/Mac 双击即用）。带货是其中最强的高转化模板，而非唯一前提。详见 [Roadmap](#roadmap)。

**关键词**: AI 视频生成 / 电商带货 / 短视频自动化 / AI 脚本生成 / 抖音视频制作 / 快手带货 / 小红书种草视频 / AIGC / Seedance 2.0 / GPT Image 2 / Kling 3.0 / Veo 3 / Nano Banana 2 / FLUX / Vidu / Hailuo

---

## 界面预览

| 首页·项目管理 | 一键示例填充 | 分镜脚本 |
|:---:|:---:|:---:|
| ![首页](docs/screenshots/01-home.png) | ![新建](docs/screenshots/03-new.png) | ![脚本](docs/screenshots/04-script.png) |
| **成片预览·下载导出** | **批量出片** | **示例作品** |
| ![导出](docs/screenshots/05-export.png) | ![批量](docs/screenshots/06-batch.png) | ![示例](docs/screenshots/02-showcase.png) |

> 示例作品「云柔加厚抽纸」：真实商品图 + 运镜 + 中文字幕 + 价格贴 + 配音，一条带货短视频全自动生成。

---

## 为什么选择带货剪手？

| 痛点 | 传统方式 | 带货剪手 |
|------|---------|---------|
| **脚本创作** | 编导写脚本 1-2 小时 | AI 30 秒生成 3 套脚本 |
| **素材制作** | 拍摄+修图 1-3 天 | AI 生图/生视频，分钟级出片 |
| **视频剪辑** | 剪辑师 2-4 小时 | 自动合成+转场+字幕+配音 |
| **多平台适配** | 手动调整比例/字幕 | 一键导出抖音/快手/小红书版本 |
| **批量出片** | 一天最多 3-5 条 | 选 10 个商品一键批量生成 |
| **成本** | 编导+拍摄+剪辑 数千元/条 | API 调用费 几元/条 |

---

## 核心功能

### 一、AI 带货脚本生成

- **5 大品类深度模板**: 美妆护肤 / 食品零食 / 家居日用 / 服饰鞋包 / 数码 3C
- **4 种脚本风格**: 痛点种草 / 场景安利 / 对比测评 / 剧情故事
- **黄金 3 秒策略库**: 视觉冲击法 / 悬念提问法 / 反差对比法 / 利益承诺法 / 情感共鸣法
- **平台 SEO 优化**: 自动生成话题标签、封面文案、互动引导语，适配抖音/快手/小红书算法
- **精准用户定位**: 支持设定目标人群、价格区间、投放平台，脚本自动匹配

### 二、AI 素材生成（多模型聚合）

一个接口聚合 6 大生图/生视频平台 + OpenRouter LLM、30+ 主流模型：

| 平台 | 图片模型 | 视频模型 | 特色 |
|------|---------|---------|------|
| **Atlas Cloud** ⭐推荐 | **GPT Image 2**, Seedream 5.0, Nano Banana 2 | **Seedance 2.0**(原生音频), Kling 3.0, Vidu Q3 | 一个 Key 聚合 LLM+生图+生视频，模型最全价格最优 |
| **fal.ai** | **GPT Image 2**(+edit), FLUX.1/2 Pro, Recraft V4, Seedream V5 Edit | Kling 3.0 Pro, Veo 3, Hailuo 2.3, Luma Ray 2, Vidu Q2 | 模型全，含 OpenAI 生图与商品保真编辑 |
| **Replicate** | FLUX 1.1 Pro/Kontext, Imagen 4, Seedream 4 | Kling v2.1, Seedance 1 Pro, Hailuo 02, Veo 3 Fast | 模型库最全，predictions API 统一调用 |
| **火山引擎（方舟 Ark）** | Seedream 5.0/4.0 | Seedance 2.0/1.0 Pro(原生音频) | 字节系明星模型，电影级画质，速度快 |
| **阿里百炼** | 通义万相 | 万相 2.6/2.5/2.2/2.1 | 商品图生视频效果好 |
| **硅基流动** | Kolors, Qwen-Image | - | 国产高性价比 |

> **LLM（脚本生成）** 走 OpenAI 兼容协议，内置 Atlas Cloud / **OpenRouter**(400+模型) / DeepSeek / Kimi / 智谱 / 豆包 / OpenAI 等一键预设。

### 三、多源免费素材引擎 🆕（不止 AI 生成）

一句英文检索词即可从多个**免费可商用**素材站拉视频/图片/音乐，自动下载落库、留存合规署名——没有商品图、不烧 AI 额度也能为每个分镜配齐画面：

| 素材源 | 免 Key | 媒体 | 说明 |
|--------|:---:|------|------|
| **Openverse** | ✅ | 图片 / 音乐 / 音效 | WordPress 维护，CC 授权，**零配置即用**（新手首选） |
| **Pixabay** | 免费 Key | 视频 / 图片 | 实拍 B-roll 主力补充 |
| **Pexels** | 免费 Key | 视频 / 图片 | 高质量可商用 |

- 统一接口 `/api/stock/search`：`source` 指定单源或 `all` **聚合检索**（keyless 源优先排序、缺 Key 的源自动跳过）
- 合规留存来源页 / 作者 / 授权（CC 源带现成署名文本），导出可生成 credits；检索词建议英文，召回更好
- 注册表式架构，后续可继续接 Coverr / Wikimedia / NASA / Freesound 等

### 四、4 种视频模式

| 模式 | 适合商品 | 策略 | 真实感 |
|------|---------|------|--------|
| **产品特写** | 高客单价商品 | 商品原图 + 运动特效，全程不出现 AI 人脸 | 最高 |
| **图文混剪** | 快消品/日用品 | 快节奏商品图 + 文字卡片 + 转场 | 高 |
| **场景演示** | 护肤/厨房/健身 | AI 生成使用场景（手部/背影，避免假脸） | 中高 |
| **真人出镜** | IP 账号 | 角色系统 + 用户上传真人素材 | 取决于素材 |

### 五、视频合成引擎

- **FFmpeg 专业管线**: H.264 High Profile 编码、faststart、256k AAC 音频，真实出片
- **中文字幕烧录**: 自动探测系统中文字体，按配音文案分时段烧录字幕（不乱码、不显方块）
- **智能转场**: AI 首尾帧过渡（Seedance 2.0 / Vidu）/ AI 参考过渡（Kling）/ 渐变 / 硬切
- **Ken Burns 运动**: 缓慢推进 / 左右横移 / 景深漂移，用运镜让静态商品图"活起来"且不篡改商品
- **音频智能处理**: 支持音频的模型直接出带配音视频，BGM 自动混音压低

### 六、电商效率工具

| 功能 | 说明 |
|------|------|
| **商品库** | 商品信息录入一次，反复生成不同风格的视频 |
| **批量出片** | 618/双11 大促前，选多个商品一键批量生成 |
| **爆款模板** | 跑出数据的脚本存为模板，一键套用到新商品 |
| **爆款复刻** | 输入竞品爆款视频链接，AI 提取脚本逻辑，换品重拍 |
| **品牌设置** | Logo 水印 / 品牌色 / 统一片尾，所有视频风格一致 |
| **人物管理** | 出镜角色跨项目复用，AI 自动保持人物外貌一致 |
| **多平台导出** | 一条视频自动适配抖音(9:16)/快手/小红书(3:4)规格 |
| **A/B 多版本** | 同商品自动生成 3 个不同开头/文案版本，测试转化率 |

### 七、平台 SEO 优化

脚本自动适配平台算法，每条视频输出完整的 SEO 物料：

```json
{
  "title": "视频标题（含核心关键词）",
  "hashtags": ["#话题标签1", "#话题标签2", "#话题标签3"],
  "coverText": "封面大字文案",
  "interactionGuide": "评论区告诉我你觉得值不值？",
  "description": "视频描述文案（含关键词）"
}
```

- **抖音**: 前3秒强钩子、每5秒信息高点、价格锚点、小黄车引导
- **快手**: 接地气场景、性价比核心、"老铁们"互动话术
- **小红书**: 精致教程感、"先收藏"引导、关键词标题优化

---

## 快速开始

> 本项目用 **pnpm**（已在 `packageManager` 声明）。请勿用 `npm install`——pnpm 的 symlink 结构会让 npm 报错。没有 pnpm：`corepack enable` 或 `npm i -g pnpm`。

```bash
# 克隆项目
git clone https://github.com/xixihhhh/daihuo-jianshou.git
cd daihuo-jianshou

# 安装依赖（必须用 pnpm）
pnpm install

# 启动开发服务器
pnpm dev

# 打开浏览器
open http://localhost:3000
```

> 每次 push / PR 由 **GitHub Actions** 自动跑 `lint → test → build`（见 `.github/workflows/ci.yml`），绿了才合入。

### 首次配置

1. 点击右上角 **设置**，配置至少一个 AI 平台的 API Key（推荐 **Atlas Cloud**，一个 Key 同时支持 LLM + 生图 + 生视频）
2. 配置 LLM（脚本生成需要，支持任何 OpenAI 兼容接口）
3. 在"默认设置"里选择默认生图 / 生视频模型（如 GPT Image 2、Seedance 2.0）
4. （可选）在"出镜人物"Tab 添加角色，在"品牌设置"Tab 配置品牌视觉
5. 回到首页，点击 **新建项目** 开始生成

> 视频合成依赖本机 **FFmpeg**（需自行安装：`brew install ffmpeg` / `apt install ffmpeg`）。

---

## 技术架构

```
┌─────────────────────────────────────────────────┐
│  前端 (Next.js 16 + React 19 + Tailwind CSS 4)  │
│  Pages: 首页/商品库/批量出片/新建/脚本/素材/合成/导出/设置  │
└──────────────────┬──────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────┐
│  API 层 (Next.js Route Handlers)                │
│  /api/llm/script  /api/ai/image  /api/ai/video  │
└──────────────────┬──────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────┐
│  业务逻辑层                                      │
│  脚本引擎 (Prompt + 模板 + SEO)                   │
│  AI Provider 抽象层 (6 平台 30+ 模型)              │
│  多源素材引擎 (Openverse/Pixabay/Pexels 聚合检索)   │
│  视频合成引擎 (FFmpeg + 转场 + 运动 + 混音)         │
└──────────────────┬──────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────┐
│  数据层                                          │
│  SQLite + Drizzle ORM / Zustand (前端状态持久化)   │
└─────────────────────────────────────────────────┘
```

| 层级 | 技术 |
|------|------|
| **框架** | Next.js 16 + React 19 |
| **语言** | TypeScript 5 (strict mode) |
| **样式** | Tailwind CSS 4 + shadcn/ui |
| **状态管理** | Zustand (localStorage persist) |
| **数据库** | SQLite + Drizzle ORM（启动自动 migrate，开箱无表也能跑） |
| **视频合成** | FFmpeg (fluent-ffmpeg) |
| **AI 集成** | OpenAI SDK (LLM) + 6 平台生图/生视频 Provider |
| **素材引擎** | 多源版权素材（Openverse 免 Key / Pixabay / Pexels），注册表式聚合检索 |
| **测试** | Vitest (102 用例) + Playwright (E2E) |
| **CI/CD** | GitHub Actions（lint + test + build） |
| **桌面打包** | Electron + electron-builder（Win/Mac，进行中） |
| **图标** | react-icons (Lucide 图标集) |

---

## 项目结构

```
src/
├── app/                              # 页面路由
│   ├── page.tsx                      # 首页（项目列表 + 快捷入口）
│   ├── products/                     # 商品库管理
│   ├── batch/                        # 批量出片
│   ├── settings/                     # 设置（AI平台/LLM/人物/品牌 四个Tab）
│   ├── project/
│   │   ├── new/                      # 新建项目（表单 + 视频模式 + 人物 + 模板）
│   │   ├── clone/                    # 爆款复刻
│   │   └── [id]/
│   │       ├── script/               # 脚本编辑（3套方案 + 存为模板）
│   │       ├── assets/               # 素材生成（逐镜头 + 批量）
│   │       ├── video/                # 视频合成（转场 + 配音 + BGM + 字幕）
│   │       └── export/               # 导出（多平台 + A/B版本 + 下载）
│   └── api/                          # API 路由
│
├── lib/
│   ├── providers/                    # AI Provider 抽象层（6平台）+ 多源素材引擎
│   │   ├── stock-types.ts            #   素材候选/下载/源注册表
│   │   ├── openverse.ts pixabay.ts pexels.ts  # 各素材源
│   │   └── stock-registry.ts         #   单源/聚合检索分发
│   ├── script-engine/                # 脚本引擎（Prompt + 模板 + SEO策略）
│   ├── video-composer/               # FFmpeg 合成引擎
│   ├── paths.ts ffmpeg-path.ts       # 可注入路径（支撑 Electron 打包）
│   ├── stores/                       # Zustand 状态管理
│   └── db/                           # SQLite + Drizzle（启动 migrate）
│
├── electron/                         # Electron 主进程 + 打包钩子（进行中）
└── components/ui/                    # shadcn/ui 组件库
```

---

## 支持的 AI 模型（2026.06 官方文档确认）

### 视频生成

| 模型 | 平台 | 音频 | 模式 | 特点 |
|------|------|------|------|------|
| **Seedance 2.0** ⭐ | Atlas Cloud | 原生支持 | T2V / I2V / 参考 / 首尾帧 | 字节最新，原生音频，4-15s，最高 1440p |
| **Kling 3.0 Pro** | fal.ai / Atlas Cloud | 原生支持 | T2V / I2V | 可灵最新，多分镜+人脸绑定 |
| **Veo 3** | fal.ai | 原生支持 | T2V | Google，对话+音效+唇形同步 |
| **Vidu Q3 Pro** | Atlas Cloud | - | T2V / I2V / 首尾帧 | 首尾帧过渡（转场神器） |
| **Hailuo 2.3** | fal.ai | - | T2V / I2V | MiniMax 海螺，运动物理逼真 |
| **Luma Ray 2** | fal.ai | - | T2V / I2V | 真实运动和物理效果 |
| **Seedance 1.5 Pro** | 火山引擎 / Atlas Cloud | - | T2V / I2V | 字节豆包，电影级画质 |
| **万相 2.6** | 阿里百炼 | - | I2V | 商品图生视频效果好 |

### 图片生成

| 模型 | 平台 | 特点 |
|------|------|------|
| **GPT Image 2** ⭐ | Atlas Cloud | OpenAI 最新，任意分辨率，商品图质感好，支持自然语言编辑（换背景/打光/改文字） |
| **Nano Banana 2** | Atlas Cloud | Google，强一致性图像编辑 |
| **FLUX.2 Pro** | fal.ai | 最新一代高质量生图 |
| **Recraft V4 Pro** | fal.ai | 设计风格突出 |
| **Seedream 5.0 Lite** | 火山引擎 / Atlas Cloud | 字节最新，中文优化，支持 edit 锁定主体重绘 |
| **万相** | 阿里百炼 | 商品场景友好 |

> T2V = 文生视频, I2V = 图生视频。支持音频的模型直接输出带配音的视频，不支持的静默输出。
> 带货场景建议优先用 **edit 类模型**（GPT Image 2 / Seedream edit）对商品原图重绘背景，锁定商品主体不被篡改。

---

## 开发

```bash
# 运行测试（102 个用例）
pnpm test

# 代码规范检查
pnpm lint

# 数据库迁移（修改 schema 后生成迁移）
pnpm drizzle-kit generate

# 构建生产版本（含 .next/standalone，供 Electron 打包）
pnpm build
```

---

## 适用场景

- **电商卖家**: 淘宝/拼多多/抖音小店，快速批量生产商品推广视频
- **短视频运营**: MCN 机构、达人工作室，提升内容产出效率
- **品牌方**: 新品上市快速产出多平台投放素材
- **独立开发者**: 基于此项目二次开发，构建 AI 视频 SaaS

---

## Roadmap

**已完成（带货全链路 + 基建）**
- [x] AI 脚本生成（5 品类 × 4 风格 + 黄金 3 秒 + 平台 SEO）
- [x] 多模型聚合（6 平台 30+ 模型，含 Seedance 2.0 / GPT Image 2 / Kling 3.0）
- [x] 素材生成接入真实模型 + **商品保真**（image-to-image 锁定商品主体）
- [x] 视频合成引擎（FFmpeg，真实出片 + 中文字幕烧录 + 运镜 + textOverlay 价格贴）
- [x] 配音 TTS（OpenAI 兼容）+ BGM 上传混音压低
- [x] 多平台导出真实重编码（抖音 9:16 / 快手 / 小红书 3:4，模糊填充）
- [x] 批量出片（并发池）+ 发布文案生成 + 套用爆款模板
- [x] **CI 流水线**（GitHub Actions：lint / test / build）
- [x] **多源免费素材引擎**（Openverse 免 Key / Pixabay / Pexels，聚合检索 + 合规署名）

**进行中（通用化 + 桌面分发）**
- [ ] 无商品「一句话主题成片」闭环（LLM 文案→英文检索词→素材自动匹配→成片）
- [ ] 免费 edge-tts 配音兜底 + 音色试听（零 Key 也能出声）
- [ ] **Electron 一键桌面包**（Win/Mac 双击即用，内置 ffmpeg/sqlite）—— 已打通启动/路径/打包，剩 better-sqlite3 的 Electron ABI 重建

**规划（真正的 AI 剪辑能力）**
- [ ] 自动字幕 ASR（whisper / transformers.js）→ 烧录字幕
- [ ] 导入已有视频做剪辑 + 去静音瘦身
- [ ] 长视频切爆款片段（接通爆款复刻的真实视频分析）
- [ ] 数字人口型（fal.ai Lipsync）/ 时间轴编辑 / 多语言配音出海

---

## License

MIT
