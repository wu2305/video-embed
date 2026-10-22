import { useState } from "react";
import { isArchive, resultKey, sourceOf, type Hit, type Person, type Result, type SourceId, type SourceStatus } from "../../types";
import { countBySource } from "../../lib/fuse";
import { Button } from "../atoms/Button";
import { Chip } from "../atoms/Chip";
import { ArchiveCard } from "../molecules/ArchiveCard";
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
  /** Opens a NAS hit's preview. Archive records are links and open in the Archive System. */
  onOpen?: (hit: Hit) => void;
}

type Filter = "all" | SourceId;

const LABEL: Record<SourceId, MessageKey> = { nas: "results.sourceNas", archive: "results.sourceArchive" };
const NAME: Record<SourceId, MessageKey> = { nas: "results.nasIndex", archive: "results.archiveSystem" };

/**
 * Status line, source filter and the card grid. Covers the loading, error,
 * empty, partial (one source down) and populated states.
 */
export function ResultGrid({ results, query = "", people, sources, selectedId = null, loading = false, error = null, label, onRetry, onOpen }: ResultGridProps) {
  const { t } = useI18n();
  const [filter, setFilter] = useState<Filter>("all");
  const sectionLabel = label ?? t("results.label");
  const counts = countBySource(results);
  const down = (sources ?? []).filter((s) => s.state === "unavailable");
  const mixed = counts.nas > 0 && counts.archive > 0;
  const shown = filter === "all" ? results : results.filter((r) => sourceOf(r) === filter);

  let status = "";
  if (loading) status = t("results.searching");
  else if (error) status = t("results.failed");
  else if (query) {
    status = results.length ? t("results.count", { count: results.length, query }) : t("results.none", { query });
    if (mixed) status += t("results.bySource", { nas: counts.nas, archive: counts.archive });
  }

  return (
    <section aria-label={sectionLabel} aria-busy={loading || undefined}>
      <div className={`mm-status${error ? " error" : ""}`} role="status">{status}</div>
      {error && (
        <div className="mm-notice bad" role="alert">
          <p style={{ margin: 0 }}>{t("results.serverError")}</p>
          <div className="mm-row" style={{ marginTop: 8 }}>
            {onRetry && <Button onClick={onRetry}>{t("results.retry")}</Button>}
            <details className="mm-hint"><summary>{t("results.details")}</summary><code className="mm-mono">{error}</code></details>
          </div>
        </div>
      )}
      {!loading && !error && down.map((s) => (
        <div key={s.source} className="mm-notice warn" role="alert">
          {t("results.down", { name: t(NAME[s.source]) })}
        </div>
      ))}
      {!loading && !error && mixed && (
        <div className="mm-chips" role="group" aria-label={t("results.filter")} style={{ marginBottom: 14 }}>
          {(["all", "nas", "archive"] as const).map((f) => (
            <Chip key={f} pressed={filter === f} onClick={() => setFilter(f)}>
              {f === "all" ? t("results.filterAll", { count: results.length }) : `${t(LABEL[f])} (${counts[f]})`}
            </Chip>
          ))}
        </div>
      )}
      {!loading && !error && results.length === 0 && query && (
        <div className="mm-empty">
          {t("results.empty")}
        </div>
      )}
      <div className="mm-grid">
        {/* While a search runs, placeholders replace the old results so nothing stale reads as live. */}
        {loading && Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="mm-card mm-skeleton" aria-hidden>
            <div className="mm-thumb" />
            <div className="mm-body"><span /><span /><span /></div>
          </div>
        ))}
        {!loading && !error && shown.map((r, index) => (isArchive(r)
          ? <ArchiveCard key={resultKey(r)} record={r} rank={index + 1} />
          : <ResultCard key={resultKey(r)} hit={r} rank={index + 1} people={people} showSource={mixed} selected={r.unit_id === selectedId} onOpen={onOpen} />
        ))}
      </div>
      {!loading && !error && results.length > 0 && (
        <p className="mm-hint" style={{ margin: "12px 0 0" }}>{t("results.allowedOnly")}</p>
      )}
    </section>
  );
}
