# ClipForge agent skill

`clipforge/SKILL.md` packages ClipForge's video pipeline as an **agent skill** (the `SKILL.md` convention used by Claude Code, Cursor, Copilot, Windsurf, …), so an AI coding assistant can drive ClipForge in natural language — "make me a 9:16 video about …" — and it runs the whole pipeline (script → footage → voiceover → subtitles → compose).

It complements ClipForge's [MCP server](../mcp/README.md): the MCP exposes callable tools; this skill teaches an assistant *when and how* to use them (plus the CLI / HTTP API).

## Install

Copy the skill folder into your assistant's skills directory:

```bash
# Claude Code (user-level, or your project's .claude/skills/)
cp -r skills/clipforge ~/.claude/skills/

# Cursor / Windsurf / Copilot: copy into the project's rules/skills folder, e.g.
cp -r skills/clipforge .cursor/skills/          # Cursor
cp -r skills/clipforge .windsurf/skills/        # Windsurf
```

Then start a ClipForge instance (`pnpm dev`), set `CLIPFORGE_LLM_*` for script generation, and ask your assistant to create a video — e.g. *"make me a 9:16 video from this product link …"* (drives the one-shot `clipforge_product_script`). See [`clipforge/SKILL.md`](clipforge/SKILL.md) for prerequisites, the three drive methods (MCP / CLI / HTTP), and all workflows.
