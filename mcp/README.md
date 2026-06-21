# ClipForge MCP Server

让 **Claude Desktop / Claude Code / Cursor** 等任意 MCP 客户端直接调用 ClipForge 的「一句话成片」能力——一句主题，自动出片。

Drive ClipForge's text-to-video pipeline from any MCP client (Claude Desktop / Claude Code / Cursor). One sentence in, a finished vertical video out.

> 本服务是 ClipForge HTTP API 的薄封装：复用其全部编排（脚本引擎 / 免费素材 / 免费 Edge TTS / FFmpeg 合成）。运行前需先启动一个 ClipForge 实例（`pnpm dev` 或 `pnpm start`）。
> This server is a thin wrapper over ClipForge's HTTP API — start a ClipForge instance first (`pnpm dev` / `pnpm start`).

## 工具 / Tools

| Tool | 说明 | 需要 LLM Key |
|------|------|:---:|
| `clipforge_create_video` | 一句话 → 脚本 → 免费配画面 → 免费配音+字幕 → 合成竖屏成片，返回可下载 mp4 地址 | ✅ |
| `clipforge_generate_script` | 只生成去商品化旁白分镜脚本（含英文素材检索词） | ✅ |
| `clipforge_search_stock` | 从免费可商用素材库检索画面（keyless Openverse 图片优先） | — |
| `clipforge_list_projects` | 列出 ClipForge 里的项目 | — |
| `clipforge_compose` | 为已有脚本+素材的项目合成出片（免费 Edge TTS） | — |

> 素材（Openverse）与配音（微软 Edge TTS）全程 **免 Key**；只有「生成脚本」需要一个 OpenAI 兼容的 LLM Key。
> Stock footage (Openverse) and voiceover (Edge TTS) are **key-less**; only script generation needs an OpenAI-compatible LLM key.

## 环境变量 / Environment

| 变量 | 必需 | 说明 |
|------|:---:|------|
| `CLIPFORGE_BASE_URL` | — | ClipForge 实例地址，默认 `http://localhost:3000` |
| `CLIPFORGE_LLM_BASE_URL` | 写脚本时 | OpenAI 兼容接口，如 `https://api.atlascloud.ai/v1` |
| `CLIPFORGE_LLM_API_KEY` | 写脚本时 | LLM Key |
| `CLIPFORGE_LLM_MODEL` | 写脚本时 | 模型名，如 `deepseek-ai/deepseek-v3.2` |

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

## 试一试 / Try it

启动 ClipForge（`pnpm dev`）后，在客户端里直接说：

> 用 clipforge 做一条关于「在家如何泡手冲咖啡」的竖屏短视频

Agent 会调用 `clipforge_create_video`，几十秒后返回可下载的 mp4 地址。

## 本地直接跑 / Run directly

```bash
pnpm mcp            # = node mcp/clipforge-mcp.mjs（stdio）
```
