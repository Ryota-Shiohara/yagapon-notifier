/**
 * Simple extractor utilities (no regex, safe)
 */

/**
 * Extract substring between startMarker and endMarker.
 * If endMarker is omitted, returns the rest of the string after startMarker.
 */
export function extractBetween(
  content: string,
  startMarker: string,
  endMarker?: string
): string | null {
  const si = content.indexOf(startMarker);
  if (si === -1) return null;
  const start = si + startMarker.length;
  if (!endMarker) {
    return content.slice(start).trim();
  }

  const ei = content.indexOf(endMarker, start);
  if (ei === -1) return null;
  return content.slice(start, ei).trim();
}
