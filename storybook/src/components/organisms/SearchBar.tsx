import { useMemo, useState } from "react";
import type { ParsedQuery, Person } from "../../types";
import { parseQuery } from "../../lib/parseQuery";
import { Button } from "../atoms/Button";
import { Field } from "../molecules/Field";
import { ParseStep } from "../molecules/ParseStep";

export interface SearchParams {
  query: string;
  parsed: ParsedQuery;
  limit: number;
  min_faces: number;
}

export interface SearchBarProps {
  people: readonly Person[];
  initialQuery?: string;
  busy?: boolean;
  onSearch?: (params: SearchParams) => void;
}

/**
 * The console form plus scene 3's "who / what" readout. People are named in
 * the query itself ("Ana and Ben are cooking"), never picked by cluster id;
 * the readout shows who will be filtered and what will be embedded.
 */
export function SearchBar({ people, initialQuery = "", busy = false, onSearch }: SearchBarProps) {
  const [query, setQuery] = useState(initialQuery);
  const [limit, setLimit] = useState(12);
  const [minFaces, setMinFaces] = useState(0);
  const parsed = useMemo(() => parseQuery(query, people), [query, people]);
  const hasWho = parsed.who.length > 0 || parsed.unresolved.length > 0;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!query.trim() || parsed.unresolved.length) return;
    onSearch?.({ query: query.trim(), parsed, limit, min_faces: minFaces });
  }

  return (
    <form className="mm-panel" onSubmit={submit} role="search" aria-label="Search the index">
      <div className="mm-search">
        <Field label="query" grow>
          <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Ana Ruiz is cooking" autoComplete="off" />
        </Field>
        <Field label="limit">
          <input type="number" min={1} max={60} value={limit} onChange={(e) => setLimit(Number(e.target.value))} style={{ width: 80 }} />
        </Field>
        <Field label="min faces">
          <input type="number" min={0} max={20} value={minFaces} onChange={(e) => setMinFaces(Number(e.target.value))} style={{ width: 90 }} />
        </Field>
        <Button variant="primary" type="submit" disabled={busy || !query.trim() || parsed.unresolved.length > 0}>
          {busy ? "searching…" : "search"}
        </Button>
      </div>
      {hasWho && (
        <div className="mm-parse" aria-live="polite">
          {parsed.who.map((name, i) => <ParseStep key={name} tone="accent">who <b>{name}</b> → {parsed.person_ids[i]}</ParseStep>)}
          {parsed.unresolved.map((name) => <ParseStep key={name} tone="bad">no such person <b>{name}</b></ParseStep>)}
          {parsed.unresolved.length === 0 && <ParseStep>what <b>{parsed.what}</b></ParseStep>}
        </div>
      )}
    </form>
  );
}
