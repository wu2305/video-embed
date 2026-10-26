import { useEffect, useRef, useState } from "react";
import { isArchive, isMetric, resultKey, sourceOf, type Hit, type MetricRecord, type Person, type Result, type SourceId, type SourceStatus } from "../../types";
import { countBySource } from "../../lib/fuse";
import { Button } from "../atoms/Button";
import { Chip } from "../atoms/Chip";
import { ArchiveCard } from "../molecules/ArchiveCard";
import { MetricCard } from "../molecules/MetricCard";
import { ResultCard } from "../molecules/ResultCard";
import { useI18n, type MessageKey } from "../../i18n";

export interface ResultGridProps {
  /** Already fused across sources, best first. */
  results: readonly Result[];
  query?: string;
  people?: readonly Person[];
  /** How each source answered. Omit for a NAS-only list. */
  sources?: readonly SourceStatus[];
  selectedId?: number | null;
  loading?: boolean;
  error?: string | null;
  /** Landmark name; change it when a page shows more than one grid. */
  label?: string;
  /** Runs the same query again after an error. */
  onRetry?: () => void;
  /** Opens a NAS hit's preview. Archive records are links into the Archive System. */
  onOpen?: (hit: Hit) => void;
  /** Opens a BI metric's preview. */
  onOpenMetric?: (metric: MetricRecord) => void;
  selectedMetricId?: string | null;
  /** The gateway has another page (its `next_cursor` is set). */
  more?: boolean;
  /** The next page is on its way. */
  loadingMore?: boolean;
  /** The next page failed; the results already shown stay. */
  moreError?: boolean;
  /** Asks for the next page. The caller appends it to `results`. */
  onMore?: () => void;
}

type Filter = "all" | SourceId;

const SOURCES: readonly SourceId[] = ["nas", "archive", "bi"];
const LABEL: Record<SourceId, MessageKey> = { nas: "results.sourceNas", archive: "results.sourceArchive", bi: "results.sourceBi" };
const NAME: Record<SourceId, MessageKey> = { nas: "results.nasIndex", archive: "results.archiveSystem", bi: "results.biPlatform" };

/**
 * Status line, source filter and the card grid. Covers the loading, error,
 * empty, partial (one source down) and populated states.
 */
export function ResultGrid({
  results, query = "", people, sources, selectedId = null, loading = false, error = null, label, onRetry, onOpen, onOpenMetric, selectedMetricId = null,
  more = false, loadingMore = false, moreError = false, onMore,
}: ResultGridProps) {
  const { t, rich } = useI18n();
  const [filter, setFilter] = useState<Filter>("all");
  const sectionLabel = label ?? t("results.label");
  const counts = countBySource(results);
  const down = (sources ?? []).filter((s) => s.state === "unavailable");
  // The filter only offers sources that returned something.
  const present = SOURCES.filter((s) => counts[s] > 0);
  const mixed = present.length > 1;
  // A source picked for an earlier query may be absent from this one.
  const active: Filter = mixed && present.includes(filter as SourceId) ? filter : "all";
  const shown = active === "all" ? results : results.filter((r) => sourceOf(r) === active);

  // After Load more, focus moves to the first new card, so a keyboard user
  // carries on reading where the list grew instead of back at the button.
  const grid = useRef<HTMLDivElement>(null);
  // Under a source filter the new page may hold none of that source; focus then stays on the button.
  const before = useRef<{ shown: number; results: number } | null>(null);
  useEffect(() => {
    const at = before.current;
    if (at === null || results.length <= at.results) return;
    before.current = null;
    if (shown.length > at.shown) grid.current?.children[at.shown]?.querySelector<HTMLElement>(".mm-card-link")?.focus();
  }, [results.length]);
  function loadMore() {
    if (loadingMore) return;
    before.current = { shown: shown.length, results: results.length };
    onMore?.();
  }

  // The count is the answer, so it takes the text colour; the rest stays muted.
  // The query itself is not repeated: it is still in the field above.
  let status: React.ReactNode = "";
  if (loading) status = t("results.searching");
  else if (!error && query) status = results.length ? <>{rich(more ? "results.countSoFar" : "results.count", { count: <b>{results.length}</b> })}</> : t("results.none");

  return (
    <section aria-label={sectionLabel} aria-busy={loading || undefined}>
      <div className={`mm-status${error ? " error" : ""}`} role="status">{status}</div>
      {error && (
        <div className="mm-notice bad" role="alert">
          <p style={{ margin: 0 }}>{t("results.serverError")}</p>
          {onRetry && <div className="mm-row" style={{ marginTop: 8 }}><Button onClick={onRetry}>{t("results.retry")}</Button></div>}
        </div>
      )}
      {!loading && !error && down.map((s) => (
        <div key={s.source} className="mm-notice warn" role="alert">
          {t("results.down", { name: t(NAME[s.source]) })}
        </div>
      ))}
      {!loading && !error && mixed && (
        <div className="mm-chips" role="group" aria-label={t("results.filter")} style={{ marginBottom: 14 }}>
          {(["all", ...present] as const).map((f) => (
            <Chip key={f} pressed={active === f} onClick={() => setFilter(f)}>
              {f === "all" ? t("results.filterAll") : `${t(LABEL[f])} (${counts[f]})`}
            </Chip>
          ))}
        </div>
      )}
      <div ref={grid} className="mm-grid">
        {/* While a search runs, placeholders replace the old results so nothing stale reads as live. */}
        {loading && Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="mm-card mm-plain mm-skeleton" aria-hidden>
            <div className="mm-body"><span /><span /><span /></div>
          </div>
        ))}
        {!loading && !error && shown.map((r, index) => (isArchive(r)
          ? <ArchiveCard key={resultKey(r)} record={r} rank={index + 1} />
          : isMetric(r)
          ? <MetricCard key={resultKey(r)} metric={r} rank={index + 1} selected={r.metric_id === selectedMetricId} onOpen={onOpenMetric} />
          : <ResultCard key={resultKey(r)} hit={r} rank={index + 1} people={people} showSource={mixed} selected={r.unit_id === selectedId} onOpen={onOpen} />
        ))}
      </div>
      {!loading && !error && more && onMore && (
        <div className="mm-more-results">
          {moreError && <div className="mm-notice bad" role="alert"><p style={{ margin: 0 }}>{t("results.moreFailed")}</p></div>}
          <Button className={loadingMore ? "mm-busy" : undefined} aria-disabled={loadingMore || undefined} onClick={loadMore}>
            {moreError ? t("results.retry") : loadingMore ? t("results.loadingMore") : t("results.more")}
          </Button>
        </div>
      )}
    </section>
  );
}
