import type { Hit, Person } from "../types";
import { ResultCard } from "./ResultCard";

export interface ResultGridProps {
  hits: readonly Hit[];
  query?: string;
  people?: readonly Person[];
  selectedId?: number | null;
  loading?: boolean;
  error?: string | null;
  onOpen?: (hit: Hit) => void;
}

/** Status line plus the card grid. Covers the loading, error, empty and populated states. */
export function ResultGrid({ hits, query = "", people, selectedId = null, loading = false, error = null, onOpen }: ResultGridProps) {
  let status = "";
  if (loading) status = "searching…";
  else if (error) status = `error: ${error}`;
  else if (query) status = hits.length ? `${hits.length} hits for “${query}”` : `no hits for “${query}”`;

  return (
    <section aria-label="Search results">
      <div className={`mm-status${error ? " error" : ""}`} role="status">{status}</div>
      {!loading && !error && hits.length === 0 && query && (
        <div className="mm-empty">Try fewer filters, or remove the name from the query.</div>
      )}
      <div className="mm-grid">
        {!error && hits.map((hit, index) => (
          <ResultCard key={hit.unit_id} hit={hit} rank={index + 1} people={people} selected={hit.unit_id === selectedId} onOpen={onOpen} />
        ))}
      </div>
    </section>
  );
}
