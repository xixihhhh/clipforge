// HTTP Range header parsing for media file routes (single-range "bytes=" forms only)

/** Resolved byte range, inclusive on both ends */
export interface ByteRange {
  start: number;
  end: number;
}

/**
 * Parse an HTTP Range header against a file of the given size.
 *
 * Supported forms (single range only): "bytes=start-end", "bytes=start-", "bytes=-suffix".
 *
 * Returns:
 * - null when the header is absent/empty → caller should respond 200 with the full body
 * - "unsatisfiable" when the header is present but malformed or cannot be satisfied
 *   (e.g. start > end, start >= size, multi-range) → caller should respond 416
 * - a ByteRange (end clamped to size - 1) → caller should respond 206
 */
export function parseRangeHeader(
  header: string | null | undefined,
  size: number
): ByteRange | "unsatisfiable" | null {
  if (!header) return null;

  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return "unsatisfiable";

  const [, startStr, endStr] = match;

  // "bytes=-" carries no positions at all → malformed
  if (!startStr && !endStr) return "unsatisfiable";

  // A zero-byte file cannot satisfy any range
  if (size <= 0) return "unsatisfiable";

  if (!startStr) {
    // Suffix form "bytes=-N": the last N bytes of the file
    const suffixLength = Number(endStr);
    if (suffixLength === 0) return "unsatisfiable";
    return { start: Math.max(0, size - suffixLength), end: size - 1 };
  }

  const start = Number(startStr);
  const end = endStr ? Number(endStr) : size - 1;

  if (start >= size) return "unsatisfiable";
  if (start > end) return "unsatisfiable";

  return { start, end: Math.min(end, size - 1) };
}
