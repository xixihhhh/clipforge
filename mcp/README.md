# ClipForge MCP Server

让 **Claude Desktop / Claude Code / Cursor** 等任意 MCP 客户端直接调用 ClipForge 的「一句话成片」能力——一句主题，自动出片。

Drive ClipForge's text-to-video pipeline from any MCP client (Claude Desktop / Claude Code / Cursor). One sentence in, a finished vertical video out.

> 本服务是 ClipForge HTTP API 的薄封装：复用其全部编排（脚本引擎 / 免费素材 / 免费 Edge TTS / FFmpeg 合成）。运行前需先启动一个 ClipForge 实例（`pnpm dev` 或 `pnpm start`）。
> This server is a thin wrapper over ClipForge's HTTP API — start a ClipForge instance first (`pnpm dev` / `pnpm start`).

## 工具 / Tools

| Tool | 说明 | 需要 LLM Key |
|------|------|:---:|
| `clipforge_create_video` | 一句话 → 脚本 → 免费配画面 → 免费配音+字幕 → 合成竖屏成片，返回可下载 mp4 地址 | ✅ |
| `clipforge_ingest_product` | 贴商品链接 → 抓标题/价/图（JSON-LD>OG>Twitter>标题）→ 一键建带货项目下图，带货「链接优先」入口 | — |
| `clipforge_generate_script` | 只生成去商品化旁白分镜脚本（含英文素材检索词） | ✅ |
| `clipforge_search_stock` | 从免费可商用素材库检索画面（keyless Openverse 图片优先） | — |
| `clipforge_list_projects` | 列出 ClipForge 里的项目 | — |
| `clipforge_compose` | 为已有脚本+素材的项目合成出片（免费 Edge TTS）；可开 卡拉OK字幕 / 商品卡 / AI合规标识 / 购买CTA / BGM情绪 / 旁白闪避 等带货增强 | — |
| `clipforge_list_voices` | 列出可用的免费 Edge TTS 多语言音色（中/英/日/韩/西，供 voice 参数选用） | — |
| `clipforge_get_video` | 查询某项目最新合成结果（状态/可下载地址），不重合成；用于轮询异步产物或取回旧视频 | — |

> 素材（Openverse）与配音（微软 Edge TTS）全程 **免 Key**；只有「生成脚本」需要一个 OpenAI 兼容的 LLM Key。
> Stock footage (Openverse) and voiceover (Edge TTS) are **key-less**; only script generation needs an OpenAI-compatible LLM key.

> **出片后工具**（同为 MCP 工具，交付前把关/变现增强）：发布门禁 `clipforge_gate`（脚本就绪+质检+授权一键体检，`fail` 别交付）、成片质检 `clipforge_qc`、成片速览 `clipforge_contact_sheet`（agent 看图自检）、素材授权 `clipforge_credits`、平台导出 `clipforge_export_platform`、原生感 `clipforge_native_feel`、封面/图文卡/二维码/片尾扫码/译制等——完整清单与交付检查单见 [`skills/clipforge/SKILL.md`](../skills/clipforge/SKILL.md)。
> **Post-compose tools** (also MCP tools): release gate `clipforge_gate` (readiness + QC + licensing in one verdict — don't deliver on `fail`), `clipforge_qc`, `clipforge_contact_sheet` (visual self-check), `clipforge_credits`, `clipforge_export_platform`, `clipforge_native_feel`, plus cover/carousel/QR/end-card/dub — full list and the delivery checklist live in [`skills/clipforge/SKILL.md`](../skills/clipforge/SKILL.md).

> **成片选项**：`create_video` / `compose` 支持 `voice`（多语言音色，见 `clipforge_list_voices`；`create_video` 不指定则按主题语言自动挑，英文主题→英文音色）、`aspectRatio`（`9:16` 竖屏默认 / `16:9` / `1:1`）、`quality`（`fast` / `standard` / `hd`）、`bgm`（`true` 自动加一段免费 CC 背景音乐，混在旁白下方自动压低；来源 Wikimedia Commons，CC 多需署名）。一个画面都没配到时 `create_video` 会直接返回可操作的提示而非空白片。
> **Output options**: `create_video` / `compose` accept `voice` (multilingual — zh/en/ja/ko/es; `create_video` auto-picks one matching the topic's language when unset, e.g. an English topic gets an English voice), `aspectRatio` (`9:16` default / `16:9` / `1:1`), `quality` (`fast`/`standard`/`hd`) and `bgm` (`true` = add free CC background music, ducked under the voiceover).

> **视频 B-roll**：默认 `footage:"auto"` 现在**逐镜视频优先、配不到再退图片**——**全程免 Key** 就能拿到实拍动态 B-roll（Wikimedia Commons 提供 CC/公共领域视频，取 ≤720p webm 转码）。想更快可传 `footage:"image"`（只图片）；`footage:"video"` 只视频。配了 `CLIPFORGE_PEXELS_KEY` / `CLIPFORGE_PIXABAY_KEY` 则再补充 Pexels/Pixabay 高质量视频。
> **Video B-roll**: `footage:"auto"` (default) now picks **video first, falling back to image per shot** — real motion B-roll with **no key at all** (Wikimedia Commons). Pass `footage:"image"` for the fastest path; add `CLIPFORGE_PEXELS_KEY` / `CLIPFORGE_PIXABAY_KEY` for extra Pexels/Pixabay footage.

## 环境变量 / Environment

| 变量 | 必需 | 说明 |
|------|:---:|------|
| `CLIPFORGE_BASE_URL` | — | ClipForge 实例地址，默认 `http://localhost:3000` |
| `CLIPFORGE_LLM_BASE_URL` | 写脚本时 | OpenAI 兼容接口，如 `https://api.atlascloud.ai/v1` |
| `CLIPFORGE_LLM_API_KEY` | 写脚本时 | LLM Key |
| `CLIPFORGE_LLM_MODEL` | 写脚本时 | 模型名，如 `deepseek-ai/deepseek-v3.2` |
| `CLIPFORGE_PEXELS_KEY` | — | 配了才用 Pexels 实拍**视频** B-roll（免费申请） |
| `CLIPFORGE_PIXABAY_KEY` | — | 配了才用 Pixabay 实拍**视频** B-roll（免费申请） |

## 接入 Claude Desktop / Cursor

在 MCP 配置（Claude Desktop: `claude_desktop_config.json`；Cursor: `~/.cursor/mcp.json`）中加入：

```json
{
  "mcpServers": {
    "clipforge": {
      "command": "node",
      "args": ["/绝对路径/clipforge/mcp/clipforge-mcp.mjs"],
      "env": {
        "CLIPFORGE_BASE_URL": "http://localhost:3000",
        "CLIPFORGE_LLM_BASE_URL": "https://api.atlascloud.ai/v1",
        "CLIPFORGE_LLM_API_KEY": "sk-...",
        "CLIPFORGE_LLM_MODEL": "deepseek-ai/deepseek-v3.2"
      }
    }
  }
}
```

## 接入 Claude Code

```bash
claude mcp add clipforge -- node /绝对路径/clipforge/mcp/clipforge-mcp.mjs
# 然后在该 MCP 的 env 里补上 CLIPFORGE_LLM_* （或先 export 再启动）
```

## 零安装接入（发布到 npm 后）

把 `mcp/` 发布为 npm 包 `clipforge-mcp` 后，客户端无需克隆仓库、直接 `npx` 接入：

```json
{
  "mcpServers": {
    "clipforge": {
      "command": "npx",
      "args": ["-y", "clipforge-mcp"],
      "env": {
        "CLIPFORGE_BASE_URL": "http://localhost:3000",
        "CLIPFORGE_LLM_BASE_URL": "https://api.atlascloud.ai/v1",
        "CLIPFORGE_LLM_API_KEY": "sk-...",
        "CLIPFORGE_LLM_MODEL": "deepseek-ai/deepseek-v3.2"
      }
    }
  }
}
```

> `CLIPFORGE_BASE_URL` 指向一个运行中的 ClipForge 实例——最省事是 Docker：
> `docker run -d -p 3000:3000 -v clipforge-data:/data ghcr.io/xixihhhh/clipforge`

## 发布到 npm 与官方 MCP Registry

让任意 MCP 客户端 `npx` 即装，并被 Glama / Smithery / PulseMCP 等生态自动收录（本仓库已备好 `mcp/package.json`）：

```bash
# 1) 发布 npm 包（在 mcp/ 目录，用你的 npm 账号）
cd mcp && npm publish --access public
#   若 clipforge-mcp 名被占用，把 package.json 的 name 改成 @xixihhhh/clipforge-mcp 再发

# 2) 发布到官方 MCP Registry（registry.modelcontextprotocol.io）
#   装 mcp-publisher，生成并校验「当前 schema」的 server.json：
mcp-publisher init
#   编辑 server.json：name 用 io.github.xixihhhh/clipforge（GitHub OAuth 自动验证归属、免 DNS），
#   packages 指向 npm 包 clipforge-mcp，环境变量按上表补全（均可选）
mcp-publisher login github
mcp-publisher publish
```

## 试一试 / Try it

启动 ClipForge（`pnpm dev`）后，在客户端里直接说：

> 用 clipforge 做一条关于「在家如何泡手冲咖啡」的竖屏短视频

Agent 会调用 `clipforge_create_video`，几十秒后返回可下载的 mp4 地址。

## 本地直接跑 / Run directly

```bash
pnpm mcp            # = node mcp/clipforge-mcp.mjs（stdio）
```
