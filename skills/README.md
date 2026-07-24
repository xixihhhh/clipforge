# ClipForge agent skill

`clipforge-video/SKILL.md` packages ClipForge's video pipeline as an **agent skill** (the `SKILL.md` convention used by Claude Code, Cursor, Copilot, Windsurf, …), so an AI coding assistant can drive ClipForge in natural language — "make me a 9:16 video about …" — and it runs the whole pipeline (script → footage → voiceover → subtitles → compose).

It complements ClipForge's [MCP server](../mcp/README.md): the MCP exposes callable tools; this skill teaches an assistant *when and how* to use them (plus the CLI / HTTP API).

## Install

**One command** (any of the 70+ hosts supporting the agentskills.io installer):

```bash
npx skills add xixihhhh/clipforge
```

**Claude Code plugin** (installs the skill *and* the ClipForge MCP server together):

```
/plugin marketplace add xixihhhh/clipforge
/plugin install clipforge@clipforge
```

**claude.ai (web)**: download `clipforge-skill.zip` from the [latest release](https://github.com/xixihhhh/clipforge/releases/latest) and upload it under Settings → Capabilities → Skills. Note: the skill drives a **local** ClipForge instance, so it is designed for Claude Code / local agents — the claude.ai sandbox cannot reach your machine.

**Or paste this Setup prompt to your agent** (Claude Code / Codex / Cursor — the agent installs everything itself):

> Set up ClipForge (https://github.com/xixihhhh/clipforge) for me. Clone the repo, install deps with pnpm and start it (`pnpm install && pnpm dev`), register `skills/clipforge-video` in my assistant's skills directory, and verify with `node bin/clipforge.mjs --help`. Script generation needs an OpenAI-compatible LLM — ask me for a key, or wire up a free option (Ollama / Pollinations). Footage and voiceover are keyless out of the box.

**Or copy the skill folder manually:**

```bash
# Claude Code (user-level, or your project's .claude/skills/)
cp -r skills/clipforge-video ~/.claude/skills/

# Cursor / Windsurf / Copilot: copy into the project's rules/skills folder, e.g.
cp -r skills/clipforge-video .cursor/skills/    # Cursor
cp -r skills/clipforge-video .windsurf/skills/  # Windsurf
```

Then start a ClipForge instance (`pnpm dev`), set `CLIPFORGE_LLM_*` for script generation, and ask your assistant to create a video — e.g. *"make me a 9:16 video from this product link …"* (drives the one-shot `clipforge_product_script`). See [`clipforge-video/SKILL.md`](clipforge-video/SKILL.md) for prerequisites, the three drive methods (MCP / CLI / HTTP), and all workflows.
