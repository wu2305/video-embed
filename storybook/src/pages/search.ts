import type { ArchiveRecord, Hit, MetricRecord, Person, Result, SearchType, SourceStatus } from "../types";
import { fuseByRank } from "../lib/fuse";
import { parseQuery } from "../lib/parseQuery";

export interface Filters {
  query: string;
  /** Omit for every source. */
  type?: SearchType;
  limit?: number;
}

/**
 * Stand-in for the NAS side of `/api/search` over mock hits: every person
 * the query names must appear in the hit, and a video or image type keeps that kind only.
 * The corpus is taken to be already filtered to what the viewer may open.
 * Ranking is the mock score, so the order is stable.
 */
export function searchMock(corpus: readonly Hit[], people: readonly Person[], f: Filters): Hit[] {
  const parsed = parseQuery(f.query, people);
  return corpus
    .filter((h) => parsed.person_ids.every((id) => h.person_ids.includes(id)))
    .filter((h) => f.type !== "video" && f.type !== "image" || h.kind === f.type)
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

/**
 * Stand-in for the BI platform's metric search. Like the Archive, it gets only
 * the "what"; it matches metric names, ids and definitions, and each metric
 * comes back with the reports that use it.
 */
export function searchBiMock(metrics: readonly MetricRecord[], people: readonly Person[], f: Filters): MetricRecord[] {
  const words = parseQuery(f.query, people).what.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2);
  return metrics
    .filter((m) => m.report_count > 0 && words.some((w) => `${m.name} ${m.metric_id} ${m.definition ?? ""}`.toLowerCase().includes(w)))
    .sort((a, b) => a.vendor_rank - b.vendor_rank);
}

/** Sources that time out on the query. */
export interface Down {
  archive?: boolean;
  bi?: boolean;
}

/**
 * Every source the search type asks for, fused by rank. A source that is down
 * contributes nothing; a source the type leaves out is not asked and not listed.
 */
export function searchGateway(
  nas: readonly Hit[], archive: readonly ArchiveRecord[], people: readonly Person[], f: Filters,
  down: Down = {}, bi: readonly MetricRecord[] = [],
): { results: Result[]; sources: SourceStatus[] } {
  const type = f.type ?? "all";
  const asks = { nas: type === "all" || type === "video" || type === "image", archive: type === "all" || type === "archive", bi: type === "all" || type === "bi" };
  const fromNas = asks.nas ? searchMock(nas, people, f) : [];
  const fromArchive = asks.archive && !down.archive ? searchArchiveMock(archive, people, f) : [];
  const fromBi = asks.bi && !down.bi ? searchBiMock(bi, people, f) : [];
  const sources: SourceStatus[] = [];
  if (asks.nas) sources.push({ source: "nas", state: "ok", count: fromNas.length });
  if (asks.archive) sources.push({ source: "archive", state: down.archive ? "unavailable" : "ok", count: fromArchive.length });
  if (asks.bi) sources.push({ source: "bi", state: down.bi ? "unavailable" : "ok", count: fromBi.length });
  return { results: fuseByRank([fromNas, fromArchive, fromBi], f.limit ?? 12), sources };
}
