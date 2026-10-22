import { resultKey, sourceOf, type Result, type SourceId } from "../types";

/** The usual RRF constant; it keeps one source's top hit from swamping the rest. */
const K = 60;

/**
 * Reciprocal rank fusion over per-source result lists (scene 4c).
 *
 * Each list must already be in its source's own order. Only positions are
 * used, never scores: NAS cosine scores and the Archive vendor's relevance
 * are on different scales. Ties keep the order the lists were given in.
 */
export function fuseByRank(lists: readonly (readonly Result[])[], limit = Infinity): Result[] {
  const scored = new Map<string, { result: Result; score: number; first: number }>();
  let seen = 0;
  for (const list of lists) {
    list.forEach((result, index) => {
      const key = resultKey(result);
      const entry = scored.get(key) ?? { result, score: 0, first: seen++ };
      entry.score += 1 / (K + index + 1);
      scored.set(key, entry);
    });
  }
  return [...scored.values()]
    .sort((a, b) => b.score - a.score || a.first - b.first)
    .slice(0, limit)
    .map((e) => e.result);
}

/** Counts per source, for the status line and the source filter. */
export function countBySource(results: readonly Result[]): Record<SourceId, number> {
  const counts: Record<SourceId, number> = { nas: 0, archive: 0 };
  for (const r of results) counts[sourceOf(r)] += 1;
  return counts;
}
