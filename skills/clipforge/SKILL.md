---
name: clipforge-video
description: Create short vertical videos (TikTok / Reels / Shorts / 抖音 / 快手 / 小红书) from a topic, a product link/image, or a script you already wrote. ClipForge runs the full pipeline — script → footage → voiceover → subtitles → BGM → compose — with a free, no-API-key path (free stock + Edge TTS + local FFmpeg). Use when the user wants to turn an idea, product, or written narration into a finished short video.
version: 0.8.32
license: AGPL-3.0-only
homepage: https://github.com/xixihhhh/clipforge
keywords: [ai-video, faceless-video, text-to-video, tiktok, reels, shorts, 抖音, 快手, 小红书, product-video, tiktok-shop, ugc, ffmpeg, edge-tts]
---

# ClipForge — AI short-video production

ClipForge produces a finished vertical short video end to end. You drive it through its **MCP tools** (preferred), its **CLI**, or its **HTTP API**. The free path needs no API keys; only AI script generation needs one LLM key.

**Install this skill:** copy this folder into your assistant's skills directory — e.g. `cp -r skills/clipforge ~/.claude/skills/` (or your project's `.claude/skills/`). See [../README.md](../README.md) for per-assistant paths (Claude Code / Cursor / Copilot / Windsurf).

## Prerequisites

1. A running ClipForge instance: `pnpm dev` or `pnpm start` (default `http://localhost:3000`).
2. For script generation, an OpenAI-compatible LLM (set `CLIPFORGE_LLM_BASE_URL` / `CLIPFORGE_LLM_API_KEY` / `CLIPFORGE_LLM_MODEL`). Local/free options exist (Ollama, Pollinations).
3. Footage and voiceover are free and keyless by default; optional Pexels/Pixabay keys add more stock.

## Three ways to create

- **MCP tools** (in Claude Desktop / Cursor / Claude Code): `clipforge_create_video`, `clipforge_ingest_product`, `clipforge_product_script`, `clipforge_generate_script`, `clipforge_compose`, `clipforge_search_stock`, `clipforge_list_voices`, `clipforge_list_projects`, `clipforge_get_video`, `clipforge_trends`, `clipforge_import_script`, `clipforge_dub`, `clipforge_cover`, `clipforge_carousel`, `clipforge_shop_qr`, `clipforge_end_card`, `clipforge_qc`, `clipforge_credits`, `clipforge_native_feel`, `clipforge_preview_gif`, `clipforge_export_subtitle`.
- **CLI**: `node bin/clipforge.mjs <create|product|import|compose|dub|cover|qr|endcard|qc|credits|native|carousel|list|voices|get|trends> [flags]` (`--help` for all).
- **HTTP**: `POST /api/topic/script` → `POST /api/project/[id]/stock-fill` → `POST /api/project/[id]/compose` → poll `GET /api/project/[id]/compose`.

## Workflows

### 1. One-line topic → video
Give a topic; ClipForge writes the narration, auto-fills free footage, voices it, and composes.
- MCP: `clipforge_create_video { topic: "在家如何泡一杯手冲咖啡", aspectRatio: "9:16", quality: "standard" }`
- CLI: `node bin/clipforge.mjs create --topic "..." --quality hd --bgm`

### 2. Product / e-commerce video
Paste a product URL (auto-extracts title/price/images) or upload a product image; ClipForge writes a selling script and keeps the product image faithful. It also folds in the performance flywheel — historical conversion data biases the script toward the style/hook that actually sells.
- MCP (one shot): `clipforge_product_script { url: "https://...", styleType: "auto", durationSec: 30 }` → returns `projectId` + commerce scripts; then `clipforge_compose { projectId }`.
- CLI (link → video in one line): `node bin/clipforge.mjs product --url "https://..." --compose --bgm`.
- Low-level: `clipforge_ingest_product { url }` then generate a script and `clipforge_compose` separately.

### 3. Bring your own script
You already wrote the narration — import it, ClipForge splits it into shots and composes.
- CLI: `node bin/clipforge.mjs import --project <id> --file my-script.txt` then `compose --project <id>`.
- HTTP: `POST /api/project/[id]/import-script { script: "..." }`.

### 4. Use your own footage
Upload your own B-roll to a project's material pool; auto-fill prefers your footage, free stock tops up.
- HTTP: `POST /api/project/[id]/materials` (multipart video/image).

### 5. Public-domain archive footage (documentary / science topics)
For documentary or science content, search the keyless public-domain sources explicitly: `source: "nasa"` or `source: "archive"` via `POST /api/stock/search` or `clipforge_search_stock`.

## Output options (compose / create flags)

| Option | Values | Meaning |
|---|---|---|
| `aspectRatio` | `9:16` (default) / `16:9` / `1:1` | frame |
| `quality` / `renderPreset` | `fast` / `standard` / `hd` | resolution + x264 preset + crf |
| `voice` | Edge TTS voice id (see `clipforge_list_voices`) | free narration voice; auto-picked by topic language if omitted |
| `bgm` + `bgmMood` | `upbeat`/`chill`/`energetic`/`emotional` | free CC background music, ducked under narration |
| `karaoke` | boolean | word-by-word highlighted subtitles |
| `captionPreset` | `standard` / `bold` / `minimal` / `karaoke` | caption look: translucent-boxed / big heavy-outline no-box punch / small thin-stroke minimal / per-word karaoke |
| `productCard` | boolean | corner product card (e-commerce projects) |
| `aiDisclosure` | boolean | burn an "AI-generated" compliance label |
| `ctaText` | string | end-screen purchase CTA |

## Notes
- Subtitles can be exported as SRT/WebVTT: `GET /api/project/[id]/subtitle?format=srt|vtt`.
- `compose` is async — poll until `status: "done"`, then the response carries the downloadable mp4 URL.
- The free path (free stock + Edge TTS + local FFmpeg) costs nothing; only paid AI image/video/voice models bill per use.
