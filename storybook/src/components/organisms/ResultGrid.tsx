import { useState } from "react";
import { isArchive, resultKey, sourceOf, type Hit, type Person, type Result, type SourceId, type SourceStatus } from "../../types";
import { countBySource } from "../../lib/fuse";
import { Button } from "../atoms/Button";
import { Chip } from "../atoms/Chip";
import { ArchiveCard } from "../molecules/ArchiveCard";
import { ResultCard } from "../molecules/ResultCard";

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

const LABEL: Record<SourceId, string> = { nas: "NAS media", archive: "Archive" };
const NAME: Record<SourceId, string> = { nas: "The NAS index", archive: "The Archive System" };

/**
 * Status line, source filter and the card grid. Covers the loading, error,
 * empty, partial (one source down) and populated states.
 */
export function ResultGrid({ results, query = "", people, sources, selectedId = null, loading = false, error = null, label = "Search results", onRetry, onOpen }: ResultGridProps) {
  const [filter, setFilter] = useState<Filter>("all");
  const counts = countBySource(results);
  const down = (sources ?? []).filter((s) => s.state === "unavailable");
  const mixed = counts.nas > 0 && counts.archive > 0;
  const shown = filter === "all" ? results : results.filter((r) => sourceOf(r) === filter);

  let status = "";
  if (loading) status = "searching…";
  else if (error) status = "The search failed.";
  else if (query) {
    status = results.length ? `${results.length} results for “${query}”` : `no results for “${query}”`;
    if (mixed) status += ` · NAS ${counts.nas} · Archive ${counts.archive}`;
  }

  return (
    <section aria-label={label} aria-busy={loading || undefined}>
      <div className={`mm-status${error ? " error" : ""}`} role="status">{status}</div>
      {error && (
        <div className="mm-notice bad" role="alert">
          <p style={{ margin: 0 }}>Something went wrong on the search server, not with your query. Try again; if it keeps failing, send IT the details below.</p>
          <div className="mm-row" style={{ marginTop: 8 }}>
            {onRetry && <Button onClick={onRetry}>Try again</Button>}
            <details className="mm-hint"><summary>Details</summary><code className="mm-mono">{error}</code></details>
          </div>
        </div>
      )}
      {!loading && !error && down.map((s) => (
        <div key={s.source} className="mm-notice warn" role="alert">
          {NAME[s.source]} did not respond, so these results are incomplete. Try again in a few minutes.
        </div>
      ))}
      {!loading && !error && mixed && (
        <div className="mm-chips" role="group" aria-label="Filter by source" style={{ marginBottom: 14 }}>
          {(["all", "nas", "archive"] as const).map((f) => (
            <Chip key={f} pressed={filter === f} onClick={() => setFilter(f)}>
              {f === "all" ? `all (${results.length})` : `${LABEL[f]} (${counts[f]})`}
            </Chip>
          ))}
        </div>
      )}
      {!loading && !error && results.length === 0 && query && (
        <div className="mm-empty">
          Nothing you can open matches. Try fewer filters or remove the name from the query. Files added to the NAS today are searchable tomorrow morning.
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
        <p className="mm-hint" style={{ margin: "12px 0 0" }}>Only results you are allowed to open are shown.</p>
      )}
    </section>
  );
}
