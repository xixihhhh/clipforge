/**
 * Content-addressed TTS audio cache.
 *
 * Re-composing a project used to regenerate every voiceover from scratch, which re-bills
 * paid TTS providers (atlas/minimax/fal/OpenAI-compatible) and hammers the free Edge TTS
 * endpoint (rate-limit / 403 risk). This module caches synthesized mp3 bytes on disk,
 * keyed by a stable hash over every parameter that affects the audio output
 * (provider / model / voice / speed / text …), so an unchanged shot reuses the previous
 * audio instead of hitting the network again.
 *
 * ALL cache I/O failures degrade silently (read → miss, write → no-op): caching must
 * never break generation.
 */

import { createHash } from "crypto";
import { mkdir, readFile, rename, writeFile } from "fs/promises";
import { join } from "path";
import { getDataDir } from "@/lib/paths";

/** Buffers smaller than this are almost certainly not valid audio — never cache them */
const MIN_CACHE_BYTES = 100;

/**
 * Stable content-address for a TTS request: sha1 hex over a canonical JSON of the parts.
 *
 * Canonicalization rules:
 * - Keys are sorted, so insertion order never changes the key.
 * - undefined / null / "" values are all treated as "absent" and dropped — an omitted
 *   field and an explicitly-empty field produce the same key, because providers apply
 *   their own defaults in both cases and synthesize identical audio.
 * - Values keep their JSON types (number 1 !== string "1"). Parts are expected to be
 *   flat scalars; nested objects are hashed as-is without deep key sorting.
 */
export function ttsCacheKey(parts: Record<string, unknown>): string {
  const entries = Object.keys(parts)
    .filter((k) => {
      const v = parts[k];
      return v !== undefined && v !== null && v !== "";
    })
    .sort()
    .map((k) => [k, parts[k]]);
  return createHash("sha1").update(JSON.stringify(entries), "utf8").digest("hex");
}

/**
 * Resolve the on-disk file for a cache key, or null for keys outside the safe charset
 * (guards against a malformed key escaping the cache dir via path separators).
 */
function cachePath(key: string): string | null {
  if (!/^[a-zA-Z0-9_-]+$/.test(key)) return null;
  return join(getDataDir(), "cache", "tts", `${key}.mp3`);
}

/** Read cached audio for a key; returns null on miss or any I/O error (never throws). */
export async function readTtsCache(key: string): Promise<Buffer | null> {
  try {
    const file = cachePath(key);
    if (!file) return null;
    const buf = await readFile(file);
    // A truncated/corrupt entry (e.g. disk-full during write) must not poison playback
    return buf.length >= MIN_CACHE_BYTES ? buf : null;
  } catch {
    return null;
  }
}

/** Write-through audio for a key; skips empty/tiny buffers and swallows all I/O errors (never throws). */
export async function writeTtsCache(key: string, data: Buffer): Promise<void> {
  try {
    if (!data || data.length < MIN_CACHE_BYTES) return;
    const file = cachePath(key);
    if (!file) return;
    await mkdir(join(getDataDir(), "cache", "tts"), { recursive: true });
    // Write to a temp name then rename: concurrent compose shots never read a half-written mp3
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, data);
    await rename(tmp, file);
  } catch {
    /* cache write failures must never break generation */
  }
}
