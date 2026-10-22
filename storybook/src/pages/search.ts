import type { ArchiveRecord, Hit, Person, Result, SourceStatus } from "../types";
import { fuseByRank } from "../lib/fuse";
import { parseQuery } from "../lib/parseQuery";

export interface Filters {
  query: string;
  min_faces?: number;
  limit?: number;
}

/**
 * Stand-in for the NAS side of `/api/search` over mock hits: every person
 * the query names must appear in the hit, and the face floor applies.
 * The corpus is taken to be already filtered to what the viewer may open.
 * Ranking is the mock score, so the order is stable.
 */
export function searchMock(corpus: readonly Hit[], people: readonly Person[], f: Filters): Hit[] {
  const parsed = parseQuery(f.query, people);
  return corpus
    .filter((h) => parsed.person_ids.every((id) => h.person_ids.includes(id)))
    .filter((h) => h.face_count >= (f.min_faces ?? 0))
    .sort((a, b) => b.score - a.score)
    .slice(0, f.limit ?? 12);
}

/**
 * Stand-in for the Archive System's full-text API. The gateway sends only the
 * "what" of the query (names are NAS face clusters, which the Archive does not
 * know) and the vendor returns records in its own order.
 */
export function searchArchiveMock(records: readonly ArchiveRecord[], people: readonly Person[], f: Filters): ArchiveRecord[] {
  const words = parseQuery(f.query, people).what.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
  return records
    .filter((r) => words.some((w) => `${r.title} ${r.summary ?? ""}`.toLowerCase().includes(w)))
    .sort((a, b) => a.vendor_rank - b.vendor_rank);
}

/** Both sources for one query, fused by rank. A source that is down contributes nothing. */
export function searchGateway(
  nas: readonly Hit[], archive: readonly ArchiveRecord[], people: readonly Person[], f: Filters, archiveDown = false,
): { results: Result[]; sources: SourceStatus[] } {
  const fromNas = searchMock(nas, people, f);
  const fromArchive = archiveDown ? [] : searchArchiveMock(archive, people, f);
  return {
    results: fuseByRank([fromNas, fromArchive], f.limit ?? 12),
    sources: [
      { source: "nas", state: "ok", count: fromNas.length },
      { source: "archive", state: archiveDown ? "unavailable" : "ok", count: fromArchive.length },
    ],
  };
}
