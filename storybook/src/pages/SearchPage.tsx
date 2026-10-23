import { useEffect, useRef, useState } from "react";
import { isHit, isMetric, type ArchiveRecord, type Hit, type MetricRecord, type MetricReport, type IndexInfo, type Person, type Result, type SourceStatus, type Unavailable, type Viewer } from "../types";
import { Button } from "../components/atoms/Button";
import { Freshness } from "../components/molecules/Freshness";
import { ResultGrid } from "../components/organisms/ResultGrid";
import { MetricPreview } from "../components/organisms/MetricPreview";
import { PreviewPanel } from "../components/organisms/PreviewPanel";
import { SearchBar } from "../components/organisms/SearchBar";
import { BrandMark, TopBar, type PageId } from "../components/organisms/TopBar";
import { AppShell } from "../components/templates/AppShell";
import { annotations, duration, hitFaces, kitchenFrame, scenes } from "../mock/data";
import { searchGateway } from "./search";
import { useI18n } from "../i18n";

export interface SearchPageProps {
  people: readonly Person[];
  /** NAS hits the mock search can return, already limited to what the viewer may open. */
  corpus: readonly Hit[];
  /** Archive System records the mock vendor API can return. */
  archive?: readonly ArchiveRecord[];
  /** The Archive System times out on every query. */
  archiveDown?: boolean;
  /** BI metrics the mock metric search can return, each with the reports that use it. */
  metrics?: readonly MetricRecord[];
  /** The BI platform times out on every query. */
  biDown?: boolean;
  /** Every report per metric id, as the reports endpoint returns them. Omit to show the reports still loading. */
  metricReports?: Readonly<Record<string, readonly MetricReport[]>>;
  /** The reports endpoint fails. */
  metricReportsError?: boolean;
  /** Open the preview on this metric at load. */
  openMetricId?: string | null;
  /** NAS hits whose file the source route refuses, by unit id. */
  unavailable?: Readonly<Record<number, Unavailable>>;
  /** A query already run when the page opens. Omit for the first-visit state. */
  initialQuery?: string;
  /** Open the preview on this hit at load. */
  openId?: number | null;
  loading?: boolean;
  error?: string | null;
  index?: IndexInfo;
  now?: number;
  viewer?: Viewer;
  onNavigate?: (page: PageId) => void;
  onOpenClip?: (hit: Hit) => void;
}


/** Page: query every source at once, scan the fused results, preview the matched moment, open the clip. */
export function SearchPage({
  people, corpus, archive = [], archiveDown = false, metrics = [], biDown = false, metricReports, metricReportsError = false, openMetricId = null, unavailable = {}, initialQuery, openId = null, loading = false, error = null,
  index: indexInfo, now, viewer, onNavigate, onOpenClip,
}: SearchPageProps) {
  const { t } = useI18n();
  const runSearch = (q: string, extra: { min_faces?: number; limit?: number } = {}) =>
    searchGateway(corpus, archive, people, { query: q, ...extra }, { archive: archiveDown, bi: biDown }, metrics);
  const [query, setQuery] = useState(initialQuery ?? "");
  const [found, setFound] = useState<{ results: Result[]; sources: SourceStatus[] }>(() =>
    initialQuery ? runSearch(initialQuery) : { results: [], sources: [] });
  const [open, setOpen] = useState<number | null>(openId);
  const [openMetric, setOpenMetric] = useState<string | null>(openMetricId);
  const [playhead, setPlayhead] = useState<number | undefined>(undefined);
  // The mock error comes from props; Try again clears it and reruns the query.
  const [retried, setRetried] = useState(false);

  // Only NAS hits preview; Archive records and BI metrics open in their own systems.
  const previewable = found.results.filter(isHit);
  const position = open === null ? -1 : previewable.findIndex((h) => h.unit_id === open);
  const hit = position >= 0 ? previewable[position]! : null;
  const metric = openMetric === null ? null : found.results.filter(isMetric).find((m) => m.metric_id === openMetric) ?? null;
  const [reportsRetried, setReportsRetried] = useState(false);

  function run(q: string, extra: { min_faces?: number; limit?: number } = {}) {
    setQuery(q);
    setFound(runSearch(q, extra));
    setOpen(null);
    setOpenMetric(null);
  }

  function step(delta: number) {
    const next = previewable[Math.min(previewable.length - 1, Math.max(0, position + delta))];
    if (next) { setOpen(next.unit_id); setPlayhead(undefined); }
  }

  const gone = hit ? unavailable[hit.unit_id] : undefined;
  // Before the first query: a search home with the brand and one large field.
  const home = !query && !loading && !error;

  // While the preview is open the page behind it is inert and does not scroll.
  // On close, focus goes back to the card of the hit or metric that was last shown.
  const page = useRef<HTMLDivElement>(null);
  const lastOpen = useRef<string | null>(null);
  const isOpen = hit !== null || metric !== null;
  useEffect(() => {
    if (hit) lastOpen.current = `[data-unit-id="${hit.unit_id}"]`;
    else if (metric) lastOpen.current = `[data-metric-id="${metric.metric_id}"]`;
  }, [hit?.unit_id, metric?.metric_id]);
  const backdrop = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (isOpen) {
      // Lock only when the backdrop covers the viewport (a fixed element with
      // no containing ancestor has no offsetParent); a contained one, as in a
      // docs page, leaves the page scrollable.
      if (backdrop.current?.offsetParent !== null) return;
      const body = document.body, overflow = body.style.overflow;
      body.style.overflow = "hidden";
      return () => { body.style.overflow = overflow; };
    }
    const card = lastOpen.current;
    lastOpen.current = null;
    if (card !== null) page.current?.querySelector<HTMLElement>(`${card} .mm-card-link`)?.focus();
  }, [isOpen]);

  return (
    <div ref={page}>
      {home ? (
        <div className="mm-shell mm-home-page">
          <TopBar current="search" viewer={viewer} onNavigate={onNavigate} hideBrand />
          <main className="mm-home">
            <h1 className="mm-home-brand"><BrandMark />{t("brand.name")}</h1>
            <SearchBar home people={people} busy={loading} onSearch={(p) => run(p.query, { min_faces: p.min_faces, limit: p.limit })} />
            <div className="mm-home-foot">
              {indexInfo && <Freshness index={indexInfo} now={now} />}
            </div>
          </main>
        </div>
      ) : (
        <AppShell current="search" title={t("page.search.title")} hideTitle
          index={indexInfo} now={now} viewer={viewer} onNavigate={onNavigate} inert={isOpen}>
          <SearchBar people={people} initialQuery={query} busy={loading}
            onSearch={(p) => run(p.query, { min_faces: p.min_faces, limit: p.limit })} />
          <ResultGrid results={found.results} sources={found.sources} query={query} people={people} loading={loading} error={retried ? null : error}
            onRetry={() => { setRetried(true); run(query); }} selectedId={open} onOpen={(h) => { setOpen(h.unit_id); setPlayhead(undefined); }}
            selectedMetricId={openMetric} onOpenMetric={(m) => setOpenMetric(m.metric_id)} />
        </AppShell>
      )}

      {metric && (
        <div ref={backdrop} className="mm-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setOpenMetric(null); }}>
          <MetricPreview modal metric={metric} reports={metricReports?.[metric.metric_id] ?? null}
            error={metricReportsError && !reportsRetried} onRetry={() => setReportsRetried(true)} onClose={() => setOpenMetric(null)} />
        </div>
      )}

      {hit && (
        <div ref={backdrop} className="mm-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setOpen(null); }}>
          <PreviewPanel
            modal hit={hit} position={position + 1} total={previewable.length}
            frameSrc={hit.thumb_url ?? kitchenFrame}
            faces={hitFaces(hit)} unavailable={gone}
            people={people} annotations={hit.kind === "video" ? annotations : []} scenes={scenes} duration={duration}
            playhead={playhead} onSeek={setPlayhead}
            onPrev={() => step(-1)} onNext={() => step(1)} onClose={() => setOpen(null)}
            actions={onOpenClip && hit.kind !== "document" ? <Button variant="primary" onClick={() => onOpenClip(hit)}>{t("page.openClip")}</Button> : undefined}
          />
        </div>
      )}
    </div>
  );
}
