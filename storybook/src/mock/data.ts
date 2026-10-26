import type { Annotation, ArchiveRecord, MetricRecord, MetricReport, Face, Hit, IndexInfo, Person, Scene, Viewer } from "../types";
import { personSample, sceneFaces, sceneFrame, type Slot } from "./media";

export const people: Person[] = [
  { id: "person-0003", name: "Ana Ruiz", faces: 212 },
  { id: "person-0007", name: "Ben Okafor", faces: 96 },
  { id: "person-0011", faces: 41 },
  { id: "person-0019", faces: 17 },
];

/** Ana, Ben, person-0011 and one untagged face, from the kitchen photo (see media.lock.json). */
export const kitchenFaces: Face[] = sceneFaces("kitchen");
export const parkFaces: Face[] = sceneFaces("park");

export const kitchenFrame = sceneFrame("kitchen");
const kitchenPeople = kitchenFaces.flatMap((f) => (f.person_id ? [f.person_id] : []));

const base = {
  text_bonus: 0,
  ocr_text: "",
  asr_text: "",
  person_ids: [] as string[],
  face_count: 0,
  is_master: true,
  unit_index: 0,
  canonical_time: 1_730_000_000,
};

function hit(unit_id: number, patch: Partial<Hit> & Pick<Hit, "path" | "kind" | "score" | "similarity">): Hit {
  return { ...base, unit_id, ...patch };
}

export const cookingHit = hit(101, {
  path: "/media/2025/cooking_class_03.mp4",
  kind: "video",
  score: 0.412,
  similarity: 0.362,
  text_bonus: 0.05,
  note_bonus: 0.05,
  face_count: kitchenFaces.length,
  person_ids: kitchenPeople,
  unit_index: 4,
  scene_start: 42,
  scene_end: 71,
  asr_text: "now fold the garlic into the butter and let it soften",
  notes: ["Ana demonstrates the garlic butter"],
  thumb_url: sceneFrame("kitchen", "unit 4"),
});

export const presentingHit = hit(102, {
  path: "/media/2025/q3_review.mp4",
  kind: "video",
  score: 0.337,
  similarity: 0.337,
  face_count: 1,
  person_ids: ["person-0019"],
  unit_index: 9,
  scene_start: 72,
  scene_end: 100,
  ocr_text: "Q3 BUDGET — headcount and spend",
  thumb_url: sceneFrame("office", "unit 9"),
});

export const photoHit = hit(103, {
  path: "/media/2024/park_picnic.jpg",
  kind: "image",
  score: 0.298,
  similarity: 0.298,
  face_count: parkFaces.length,
  person_ids: [],
  scene_start: null,
  scene_end: null,
  thumb_url: sceneFrame("park", "park_picnic.jpg"),
});

export const copyHit = hit(104, {
  path: "/media/backup/cooking_class_03 (1).mp4",
  kind: "video",
  score: 0.41,
  similarity: 0.36,
  is_master: false,
  face_count: kitchenFaces.length,
  person_ids: kitchenPeople,
  scene_start: 42,
  scene_end: 71,
  thumb_url: sceneFrame("kitchen", "copy"),
});

export const audioHit = hit(105, {
  path: "/media/2023/interview_ana.m4a",
  kind: "audio",
  score: 0.281,
  similarity: 0.231,
  text_bonus: 0.05,
  asr_text: "I started cooking when I was nine, mostly bread",
  scene_start: 120,
  scene_end: 148,
  person_ids: ["person-0003"],
});

export const documentHit = hit(106, {
  path: "/media/docs/recipe_notes.pdf",
  kind: "document",
  score: 0.266,
  similarity: 0.216,
  text_bonus: 0.05,
  ocr_text: "Garlic butter: 4 cloves, 80 g butter, rest 10 min",
});

/** NAS documents: the only NAS kind the console shows. Ids 201+ keep them apart from the media hits. */
export const budgetDoc = hit(201, {
  path: "/nas/finance/2025/Q3_budget_review.xlsx",
  kind: "document",
  score: 0.402,
  similarity: 0.352,
  text_bonus: 0.05,
  ocr_text: "Q3 budget: headcount, spend and forecast by department",
});

export const bookingDoc = hit(202, {
  path: "/nas/hotels/harbourview/group_booking_terms.pdf",
  kind: "document",
  score: 0.318,
  similarity: 0.318,
  ocr_text: "Groups of 10 rooms or more: 30% deposit, rooms released 21 days before arrival",
});

export const fareDoc = hit(203, {
  path: "/nas/taxi/fleet/fare_schedule_2026.pdf",
  kind: "document",
  score: 0.291,
  similarity: 0.291,
  ocr_text: "Flag fall 13.00 · 2.30 per km · night surcharge 20% from 23:00",
});

export const budgetCopyDoc = hit(204, {
  path: "/nas/backup/finance/Q3_budget_review (1).xlsx",
  kind: "document",
  score: 0.399,
  similarity: 0.349,
  is_master: false,
  ocr_text: "Q3 budget: headcount, spend and forecast by department",
});

export const documentHits: Hit[] = [budgetDoc, bookingDoc, fareDoc, budgetCopyDoc];

/** Local time, so "today" and "tonight" read the same in every time zone. */
function at(y: number, m: number, d: number, h: number, min = 0): number {
  return Math.floor(new Date(y, m - 1, d, h, min).getTime() / 1000);
}

/** "Now" for every story: mid-morning, after last night's cycle published. */
export const now = at(2026, 10, 22, 9, 30);

/** Records the Archive System returns for "cooking" and "budget" (design doc §3.2). */
export const archiveRecords: ArchiveRecord[] = [
  {
    source: "archive", record_id: "CT-2025-0412", vendor_rank: 1,
    title: "Catering services agreement — cooking class series 2025",
    doc_type: "Contract", archived_at: at(2025, 3, 18, 10), department: "Marketing",
    summary: "Counterparty: Lumen Kitchen Studio · term 2025-04 to 2025-12 · status: active",
    deep_link: "https://archive.example.internal/records/CT-2025-0412",
  },
  {
    source: "archive", record_id: "MN-2025-1187", vendor_rank: 2,
    title: "Q3 budget review — approved minutes",
    doc_type: "Board minutes", archived_at: at(2025, 10, 2, 16), department: "Finance",
    summary: "Approved by the finance committee · 14 pages · retention: 10 years",
    deep_link: "https://archive.example.internal/records/MN-2025-1187",
  },
  {
    source: "archive", record_id: "PO-2024-2290", vendor_rank: 3,
    title: "Purchase order — kitchen equipment for the cooking studio",
    doc_type: "Purchase order", archived_at: at(2024, 11, 5, 9), department: "Facilities",
    deep_link: "https://archive.example.internal/records/PO-2024-2290",
  },
];

const BI = "https://bi.example.internal";

function report(report_id: string, title: string, kind: MetricReport["kind"], folder: string, owner: string, charts: number, updated_at: number): MetricReport {
  return { report_id, title, kind, folder, owner, charts, updated_at, deep_link: `${BI}/reports/${report_id}` };
}

const pnl = report("R-1042", "Monthly P&L", "report", "Finance / Close", "Raj Patel", 4, at(2026, 10, 20, 18));
const regional = report("R-0981", "Regional sales dashboard", "dashboard", "Sales", "Lena Vogt", 3, at(2026, 10, 21, 7));
const board = report("R-1107", "Board pack — Q3 2026", "report", "Finance / Board", "Raj Patel", 2, at(2026, 10, 2, 16));

/** Most used first: by charts that use the metric, then most recently updated. */
function byUse(reports: MetricReport[]): MetricReport[] {
  return [...reports].sort((a, b) => b.charts - a.charts || b.updated_at - a.updated_at);
}

/**
 * What `/api/bi/metrics/{metric_id}/reports` returns for each metric: every
 * report the viewer may open, most used first (docs/BI_METRIC_API.md).
 */
export const metricReports: Record<string, MetricReport[]> = Object.fromEntries(Object.entries({
  "fin.net_revenue": [
    pnl, regional, board,
    report("R-0870", "Pricing experiment readout", "report", "Growth", "Sam Okoye", 1, at(2026, 9, 14, 11)),
    report("R-0655", "Revenue by channel", "dashboard", "Marketing", "Mei Chen", 5, at(2026, 8, 30, 9)),
    report("R-0512", "Weekly business review", "report", "Exec", "Raj Patel", 1, at(2026, 10, 19, 8)),
    report("R-0233", "FY26 forecast vs actuals", "report", "Finance / Planning", "Ines Duarte", 2, at(2026, 7, 1, 12)),
  ],
  "fin.arpu": [regional, report("R-0712", "Subscriber health", "dashboard", "Product", "Lena Vogt", 2, at(2026, 10, 9, 15))],
  "mkt.class_attendance": [report("R-1210", "Cooking class series 2025", "dashboard", "Marketing / Events", "Mei Chen", 3, at(2026, 10, 18, 10))],
  "cs.churn_legacy": [],
} satisfies Record<string, MetricReport[]>).map(([id, list]) => [id, byUse(list)]));

function metric(m: Omit<MetricRecord, "source" | "reports" | "report_count" | "deep_link">): MetricRecord {
  const all = metricReports[m.metric_id] ?? [];
  return { source: "bi", ...m, reports: all.slice(0, 3), report_count: all.length, deep_link: `${BI}/metrics/${m.metric_id}` };
}

/** Metrics the BI search returns for "revenue", "cooking" and "churn" (docs/BI_METRIC_API.md). */
export const metricRecords: MetricRecord[] = [
  metric({
    metric_id: "fin.net_revenue", name: "Net revenue", domain: "Finance", owner: "Raj Patel", vendor_rank: 1,
    definition: "Gross sales minus returns, discounts and allowances",
  }),
  metric({
    metric_id: "fin.arpu", name: "Revenue per active user", domain: "Finance", owner: "Raj Patel", vendor_rank: 2,
    definition: "Net revenue ÷ monthly active users",
  }),
  metric({ metric_id: "mkt.class_attendance", name: "Cooking class attendance", domain: "Marketing", owner: "Mei Chen", vendor_rank: 3 }),
  metric({
    metric_id: "cs.churn_legacy", name: "Churn rate (legacy)", domain: "Customer success", vendor_rank: 4,
    definition: "Replaced by cs.churn_rate in 2025",
  }),
];

/** The signed-in user. Groups come from the IdP on every query. */
export const viewer: Viewer = { name: "Mei Chen", groups: ["Marketing"] };

export const hits: Hit[] = [cookingHit, presentingHit, photoHit, copyHit];

/** A 3-minute clip cut into scenes, used by the track and preview stories. */
export const duration = 180;
export const scenes: Scene[] = [
  { start: 0, end: 18 }, { start: 18, end: 42 }, { start: 42, end: 71 },
  { start: 71, end: 104 }, { start: 104, end: 139 }, { start: 139, end: 180 },
];

export const annotations: Annotation[] = [
  { id: "n1", t_start: 44, t_end: 60, text: "Ana demonstrates the garlic butter", author: "mei", person_ids: ["person-0003"] },
  { id: "n2", t_start: 72, t_end: 100, text: "Ana is presenting the Q3 budget", author: "mei", person_ids: ["person-0003"] },
  { id: "n3", t_start: 118, t_end: null, text: "Camera shake from here", author: "mei", person_ids: [] },
];

/** A face crop per person cluster, for the People page. */
export const personSamples: Record<string, string> = {
  "person-0003": personSample("person-0003"),
  "person-0007": personSample("person-0007"),
  "person-0011": personSample("person-0011"),
  "person-0019": personSample("person-0019"),
};

const HIT_SCENES: Record<number, Slot> = { 101: "kitchen", 102: "office", 103: "park", 104: "kitchen" };

/** The detected faces on a hit's keyframe; none for audio and documents. */
export function hitFaces(hit: Hit): Face[] {
  const slot = HIT_SCENES[hit.unit_id];
  return slot ? sceneFaces(slot) : [];
}

/** What the top bar reports about the published NAS snapshot: last night's cycle. */
export const indexInfo: IndexInfo = {
  units: 77_412, snapshot: "2026-10-22", published_at: at(2026, 10, 22, 2, 40), next_run: at(2026, 10, 23, 1),
};

/** No snapshot for three nights: the cycle is failing `verify` or not running. */
export const staleIndexInfo: IndexInfo = {
  ...indexInfo, snapshot: "2026-10-19", published_at: at(2026, 10, 19, 2, 40), stale: true,
};

/** Faces from recent nights that matched no person yet; they wait for the next full regroup. */
export const pendingFaces = 38;
