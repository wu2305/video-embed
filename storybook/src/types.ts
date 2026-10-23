/** Mirrors `SearchHit.to_dict()` in src/mmindex/search.py, plus fields the scenes propose. */
export type MediaKind = "video" | "image" | "audio" | "document";

export interface Hit {
  unit_id: number;
  path: string;
  score: number;
  similarity: number;
  text_bonus: number;
  kind: MediaKind;
  canonical_time: number;
  ocr_text: string;
  asr_text: string;
  person_ids: string[];
  face_count: number;
  is_master: boolean;
  unit_index: number;

  // --- proposed (not in SearchHit.to_dict() today) ---
  /** Scene range in seconds. Null for images and other still media. */
  scene_start?: number | null;
  scene_end?: number | null;
  /** Bonus from a user note, kept apart from the machine OCR/ASR bonus. */
  note_bonus?: number;
  /** Notes that overlap the scene. */
  notes?: string[];
  /** NAS hits come from this index. Absent means "nas". */
  source?: "nas";
  /** Overrides `/api/thumb?id=`, which serves the stored WebP preview (≤1024 px). */
  thumb_url?: string;
}

/**
 * One record from the Archive System's federated search (design doc §3.2).
 * The gateway never sees the raw document, only cleansed metadata, and the
 * vendor has already filtered it for the caller (§5.2). All proposed: the
 * vendor's response shape and deep-link schema are still to be confirmed.
 */
export interface ArchiveRecord {
  source: "archive";
  record_id: string;
  title: string;
  /** Vendor record type, e.g. "Contract". */
  doc_type: string;
  /** Archive date, epoch seconds. */
  archived_at: number;
  department?: string;
  /** Short metadata summary the vendor returns. Never document text. */
  summary?: string;
  /** Opens the record's detail page in the Archive System. */
  deep_link: string;
  /** Position in the vendor's own ranking. Its scores are not comparable to ours. */
  vendor_rank: number;
}

/** A BI report or dashboard that uses a metric (docs/BI_METRIC_API.md). */
export interface MetricReport {
  report_id: string;
  title: string;
  kind: "report" | "dashboard";
  /** Workspace or folder the report lives in. */
  folder?: string;
  owner?: string;
  /** Charts or tables in the report that use the metric. */
  charts: number;
  /** Last modified, epoch seconds. */
  updated_at: number;
  /** Opens the report in the BI platform. */
  deep_link: string;
}

/**
 * One metric from the gateway's BI metric search (docs/BI_METRIC_API.md).
 * `reports` is the first few reports only; the preview loads the full list
 * from `/api/bi/metrics/{metric_id}/reports`. Reports the caller may not
 * open are left out of both the list and `report_count`.
 */
export interface MetricRecord {
  source: "bi";
  metric_id: string;
  name: string;
  /** Business domain or owning team, e.g. "Finance". */
  domain?: string;
  owner?: string;
  /** The platform's own definition text. */
  definition?: string;
  /** The top reports, at most three. */
  reports: MetricReport[];
  /** Reports the caller may open that use the metric. */
  report_count: number;
  /** Opens the metric's page in the BI platform. */
  deep_link: string;
  /** Position in the platform's own ranking. */
  vendor_rank: number;
}

/** One row of a gateway result list. */
export type Result = Hit | ArchiveRecord | MetricRecord;

export type SourceId = "nas" | "archive" | "bi";

/** What a search asks for: every source, NAS videos or images only, or one other source. */
export type SearchType = "all" | "video" | "image" | "archive" | "bi";

export function sourceOf(result: Result): SourceId {
  return result.source ?? "nas";
}

export function isArchive(result: Result): result is ArchiveRecord {
  return result.source === "archive";
}

export function isMetric(result: Result): result is MetricRecord {
  return result.source === "bi";
}

/** Only NAS hits have a file and a preview. */
export function isHit(result: Result): result is Hit {
  return sourceOf(result) === "nas";
}

/** A stable key across sources: unit ids and record ids can collide. */
export function resultKey(result: Result): string {
  if (isArchive(result)) return `archive:${result.record_id}`;
  if (isMetric(result)) return `bi:${result.metric_id}`;
  return `nas:${result.unit_id}`;
}

/** How each source answered one query. */
export interface SourceStatus {
  source: SourceId;
  state: "ok" | "unavailable";
  count: number;
}

/** The signed-in user, as the gateway resolves them from the IdP (design doc §3.1.1, §5). */
export interface Viewer {
  name: string;
  /** Directory groups, resolved live on each query; shown for "why can't I see it" questions. */
  groups: string[];
}

/** What the gateway reports about the published NAS snapshot (design doc §4.2). */
export interface IndexInfo {
  units: number;
  snapshot: string;
  /** When the snapshot was published, epoch seconds. */
  published_at: number;
  /** When the next nightly cycle starts, epoch seconds. */
  next_run: number;
  /** True when nothing was published for longer than the nightly cadence. */
  stale?: boolean;
}

/** Why a NAS hit cannot be previewed although the snapshot lists it. */
export type Unavailable = "forbidden" | "gone";

/** A person cluster, optionally named by a user (scene 1). */
export interface Person {
  id: string;
  name?: string;
  /** Appearances in files the viewer can open, not in the whole index. */
  faces: number;
}

/** One detected face. `bbox` is [x, y, w, h], each normalised to 0..1 (scene 1). */
export interface Face {
  face_index: number;
  bbox: [number, number, number, number];
  person_id: string | null;
}

export type TagScope = "cluster" | "face";

export interface Annotation {
  id: string;
  t_start: number;
  t_end: number | null;
  text: string;
  author: string;
  person_ids: string[];
}

export interface Scene {
  start: number;
  end: number;
}

export interface ParsedQuery {
  who: string[];
  person_ids: string[];
  what: string;
  /** Names in the query that match no person. */
  unresolved: string[];
}
