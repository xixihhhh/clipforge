# ClipForge — AI Short-Video Creator

> Turn one sentence, or a single product photo, into a vertical short video — AI writes the script, auto-fills footage, adds a voiceover, and renders it in one click.

<p align="right"><a href="README.md">中文</a> · <strong>English</strong></p>

<p align="center">
  <img src="https://github.com/xixihhhh/clipforge/actions/workflows/ci.yml/badge.svg" alt="CI" />
  <img src="https://img.shields.io/badge/License-AGPL%20v3-blue?style=flat-square" alt="License: AGPL v3" />
  <img src="https://img.shields.io/badge/Next.js-16-black?style=flat-square&logo=next.js" alt="Next.js 16" />
  <img src="https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react" alt="React 19" />
  <img src="https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript" alt="TypeScript 5" />
  <img src="https://img.shields.io/badge/Tailwind-4-06B6D4?style=flat-square&logo=tailwindcss" alt="Tailwind CSS 4" />
  <img src="https://img.shields.io/badge/FFmpeg-compositing-007808?style=flat-square&logo=ffmpeg" alt="FFmpeg" />
</p>

**ClipForge** is a local-first, open-source AI short-video creator with a **bilingual UI (中文 / English, one-click toggle)**. It offers two zero-friction paths:

- **One sentence → video** (no product, no API key required): type a topic → AI writes a voiceover script → footage is auto-pulled from free stock libraries (keyless Openverse) → free AI voiceover (Microsoft Edge keyless TTS) → FFmpeg renders a vertical short.
- **Product / commerce video**: upload product photos → AI analyzes selling points and generates multiple scripts → per-shot assets are generated → composed → exported for TikTok / Douyin / Kuaishou / Xiaohongshu, etc.

Commerce is just the highest-converting template, not a prerequisite — ClipForge targets short-video creation for **any topic, worldwide**.

---

## Why ClipForge

| Pain point | Traditional way | ClipForge |
|------------|-----------------|-----------|
| **Scripting** | A writer spends 1–2 hours | AI generates 3 scripts in ~30s |
| **Footage** | Shoot + edit, 1–3 days | AI generation or free stock, in minutes |
| **Editing** | An editor spends 2–4 hours | Auto compose + transitions + subtitles + voiceover |
| **Voiceover** | Hire a VO artist / pay per TTS | **Free** keyless Edge TTS fallback, zero cost |
| **Multi-platform** | Manually re-crop & re-caption | One-click export per platform |
| **Cost** | Thousands per video | A few cents of API calls — or **$0** in the free path |

---

## Core features

### 1. One-sentence to video (zero config)
Pick a narration style (knowledge / story / lifestyle / inspiration / travel); every shot ships English search terms so footage can be auto-matched. No product, no API key — free stock + free TTS the whole way.

### 2. AI commerce scripting
A short-video director persona built on AIDA + the "golden 3 seconds", with category templates, platform-specific SEO, and 4 video modes (product close-up / graphic montage / scene demo / live presenter).

### 3. Multi-source free stock engine
Keyword search across **free, commercially-usable** libraries — **Openverse** (keyless, CC), **Pixabay**, **Pexels** — with aggregate search, attribution capture, and an "always returns footage" broadening fallback so even niche topics never leave a shot blank.

### 4. AI asset generation (multi-provider)
Aggregates many image/video models across providers (Atlas Cloud, fal.ai, Replicate, Volcengine Ark, Alibaba, SiliconFlow) — Seedance 2.0, GPT-Image-2, Kling, Veo, FLUX, and more — with product-fidelity image-to-image editing so the product itself is never distorted.

### 5. Voiceover — two channels
- **Free**: Microsoft Edge keyless TTS — no API key, 5 Mandarin voices, previewable. Default fallback in the compose step.
- **Paid**: OpenAI-compatible / Atlas / MiniMax / fal.ai for finer control.

### 6. FFmpeg compositing engine
H.264 High Profile + AAC, burned-in subtitles (auto-detects a CJK font), Ken Burns motion, cross-fades, mixed-source pixel-format normalization, BGM ducking, and price/selling-point overlays.

### 7. Productivity
Product library (reuse across videos), batch generation, "clone a hit" structure reuse, publish-copy generation, and per-platform export.

---

## Quick start

> Requires **pnpm** (this repo will not build correctly with npm) and a local **FFmpeg**.

```bash
pnpm install
pnpm dev          # http://localhost:3000
```

Then open **Settings** and configure an LLM (for scripts) and at least one AI platform (for image/video). The **one-sentence → video** path additionally works with only an LLM, since stock footage and voiceover are free.

### Desktop app (Electron)

```bash
pnpm dist         # builds a packaged desktop app (.dmg / .exe) under release/
```

Pre-built installers are attached to GitHub Releases.

---

## Architecture

```
Next.js 16 (App Router) + React 19 + Tailwind 4
   │  Pages: Home / One-sentence / Products / Batch / New / Script / Assets / Compose / Export / Settings
   │  i18n: zero-dependency client dictionary (zh default, en toggle)
   ├─ Script engine (prompt + templates + SEO + topic mode)
   ├─ Stock engine (Openverse / Pixabay / Pexels registry)
   ├─ AI provider layer (6 platforms, image/video)
   ├─ TTS (free Edge keyless + paid OpenAI/Atlas/MiniMax/fal)
   └─ Compositor (FFmpeg: transitions + motion + subtitles + mixing)
Drizzle ORM + better-sqlite3 (local SQLite)
```

---

## License

Licensed under **AGPL-3.0**. You may use, modify, and self-host it freely, but network/SaaS deployments of modified versions must also publish their source under the same license. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

---

<sub>ClipForge is an independent open-source project and is not affiliated with TikTok, Douyin, Kuaishou, Xiaohongshu, Microsoft, OpenAI, or any model provider. Use third-party models and stock sources in compliance with their respective terms.</sub>
