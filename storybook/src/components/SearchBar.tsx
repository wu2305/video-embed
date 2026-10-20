import { useMemo, useState } from "react";
import type { ParsedQuery, Person } from "../types";
import { parseQuery } from "../lib/parseQuery";

export interface SearchParams {
  query: string;
  parsed: ParsedQuery;
  limit: number;
  person: string;
  min_faces: number;
}

export interface SearchBarProps {
  people: readonly Person[];
  initialQuery?: string;
  busy?: boolean;
  onSearch?: (params: SearchParams) => void;
}

/**
 * The console form plus scene 3's "who / what" readout. When the query names a
 * person, the readout shows what will be filtered and what will be embedded.
 */
export function SearchBar({ people, initialQuery = "", busy = false, onSearch }: SearchBarProps) {
  const [query, setQuery] = useState(initialQuery);
  const [limit, setLimit] = useState(12);
  const [person, setPerson] = useState("");
  const [minFaces, setMinFaces] = useState(0);
  const parsed = useMemo(() => parseQuery(query, people), [query, people]);
  const hasWho = parsed.who.length > 0 || parsed.unresolved.length > 0;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!query.trim() || parsed.unresolved.length) return;
    onSearch?.({ query: query.trim(), parsed, limit, person, min_faces: minFaces });
  }

  return (
    <form className="mm-panel" onSubmit={submit} role="search" aria-label="Search the index">
      <div className="mm-search">
        <div className="mm-field mm-grow">
          <label htmlFor="mm-q">query</label>
          <input id="mm-q" type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Ana Ruiz is cooking" autoComplete="off" />
        </div>
        <div className="mm-field">
          <label htmlFor="mm-limit">limit</label>
          <input id="mm-limit" type="number" min={1} max={60} value={limit} onChange={(e) => setLimit(Number(e.target.value))} style={{ width: 80 }} />
        </div>
        <div className="mm-field">
          <label htmlFor="mm-person">person</label>
          <select id="mm-person" value={person} onChange={(e) => setPerson(e.target.value)} style={{ minWidth: 150 }} disabled={parsed.person_ids.length > 0}>
            <option value="">{parsed.person_ids.length ? "from query" : "any"}</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name ?? p.id} ({p.faces})</option>)}
          </select>
        </div>
        <div className="mm-field">
          <label htmlFor="mm-faces">min faces</label>
          <input id="mm-faces" type="number" min={0} max={20} value={minFaces} onChange={(e) => setMinFaces(Number(e.target.value))} style={{ width: 90 }} />
        </div>
        <button className="mm-primary" type="submit" disabled={busy || !query.trim() || parsed.unresolved.length > 0}>
          {busy ? "searching…" : "search"}
        </button>
      </div>
      {hasWho && (
        <div className="mm-parse" aria-live="polite">
          {parsed.who.map((name, i) => <span key={name} className="mm-step accent">who <b>{name}</b> → {parsed.person_ids[i]}</span>)}
          {parsed.unresolved.map((name) => <span key={name} className="mm-step bad">no such person <b>{name}</b></span>)}
          {parsed.unresolved.length === 0 && <span className="mm-step">what <b>{parsed.what}</b></span>}
        </div>
      )}
    </form>
  );
}
