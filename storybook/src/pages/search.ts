import type { ArchiveRecord, Hit, MetricRecord, MetricReport, MetricReportsPage, Person, Result, SearchType, SourceStatus } from "../types";
import { fuseByRank } from "../lib/fuse";
import { parseQuery } from "../lib/parseQuery";
import { REPORTS_PAGE, type ReportsRequest } from "../components/organisms/MetricPreview";

export interface Filters {
  query: string;
  /** Omit for every source. */
  type?: SearchType;
  /** Results per page. */
  limit?: number;
  /** From `next_cursor`; absent on the first page. */
  cursor?: string | null;
}

/**
 * Stand-in for the NAS side of `/api/search` over mock hits: every person
 * the query names must appear in the hit.
 * The corpus is taken to be already filtered to what the viewer may open.
 * Ranking is the mock score, so the order is stable.
 */
export function searchMock(corpus: readonly Hit[], people: readonly Person[], f: Filters): Hit[] {
  const parsed = parseQuery(f.query, people);
  return corpus
    .filter((h) => parsed.person_ids.every((id) => h.person_ids.includes(id)))
    .sort((a, b) => b.score - a.score);
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

/** One page of the gateway's fused list. */
export interface GatewayPage {
  results: Result[];
  sources: SourceStatus[];
  /** Null on the last page. */
  next_cursor: string | null;
}

/**
 * Every source the search type asks for, fused by rank. A source that is down
 * contributes nothing; a source the type leaves out is not asked and not listed.
 *
 * Paging: the gateway asks each source for its first `offset + limit` results,
 * fuses them and returns positions `offset` to `offset + limit`. Every result
 * already shown came from a better source rank than anything fetched later, so
 * a later page never reorders an earlier one and the console can append it.
 */
export function searchGateway(
  nas: readonly Hit[], archive: readonly ArchiveRecord[], people: readonly Person[], f: Filters,
  down: Down = {}, bi: readonly MetricRecord[] = [],
): GatewayPage {
  const type = f.type ?? "all";
  const limit = f.limit ?? 12;
  const offset = f.cursor ? Number(f.cursor) : 0;
  const depth = offset + limit;
  const asks = { nas: type === "all" || type === "nas", archive: type === "all" || type === "archive", bi: type === "all" || type === "bi" };
  const fromNas = asks.nas ? searchMock(nas, people, f) : [];
  const fromArchive = asks.archive && !down.archive ? searchArchiveMock(archive, people, f) : [];
  const fromBi = asks.bi && !down.bi ? searchBiMock(bi, people, f) : [];
  const sources: SourceStatus[] = [];
  if (asks.nas) sources.push({ source: "nas", state: "ok", count: fromNas.length });
  if (asks.archive) sources.push({ source: "archive", state: down.archive ? "unavailable" : "ok", count: fromArchive.length });
  if (asks.bi) sources.push({ source: "bi", state: down.bi ? "unavailable" : "ok", count: fromBi.length });
  const fused = fuseByRank([fromNas, fromArchive, fromBi].map((list) => list.slice(0, depth)));
  const more = [fromNas, fromArchive, fromBi].some((list) => list.length > depth) || fused.length > depth;
  return { results: fused.slice(offset, depth), sources, next_cursor: more ? String(depth) : null };
}

/** Stand-in for `/api/bi/metrics/{metric_id}/reports`: one page of a metric's reports. */
export function queryReports(all: readonly MetricReport[], { q = "", offset = 0, limit = REPORTS_PAGE }: Partial<ReportsRequest>): MetricReportsPage {
  const wanted = q.trim().toLowerCase();
  const matched = wanted
    ? all.filter((r) => `${r.title} ${r.folder ?? ""} ${r.owner ?? ""}`.toLowerCase().includes(wanted))
    : all;
  return { reports: matched.slice(offset, offset + limit), total: matched.length };
}
