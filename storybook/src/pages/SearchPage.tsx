import { useState } from "react";
import type { Hit, Person } from "../types";
import { Button } from "../components/atoms/Button";
import { Panel } from "../components/atoms/Panel";
import { ResultGrid } from "../components/organisms/ResultGrid";
import { PreviewPanel } from "../components/organisms/PreviewPanel";
import { SearchBar } from "../components/organisms/SearchBar";
import type { PageId } from "../components/organisms/TopBar";
import { AppShell } from "../components/templates/AppShell";
import { annotations, duration, kitchenFaces, kitchenFrame, scenes } from "../mock/data";
import { searchMock } from "./search";

export interface SearchPageProps {
  people: readonly Person[];
  /** Everything the mock search can return. */
  corpus: readonly Hit[];
  /** A query already run when the page opens. Omit for the first-visit state. */
  initialQuery?: string;
  /** Open the preview on this hit at load. */
  openId?: number | null;
  loading?: boolean;
  error?: string | null;
  units?: number;
  snapshot?: string;
  onNavigate?: (page: PageId) => void;
  onOpenClip?: (hit: Hit) => void;
}

const EXAMPLES = ["Ana is cooking", "Ana and Ben are cooking", "someone presenting a budget"];

/** Page: query the index, scan the hits, preview the matched moment, open the clip. */
export function SearchPage({
  people, corpus, initialQuery, openId = null, loading = false, error = null, units, snapshot, onNavigate, onOpenClip,
}: SearchPageProps) {
  const [query, setQuery] = useState(initialQuery ?? "");
  const [results, setResults] = useState<Hit[]>(() => (initialQuery ? searchMock(corpus, people, { query: initialQuery }) : []));
  const [open, setOpen] = useState<number | null>(openId);
  const [playhead, setPlayhead] = useState<number | undefined>(undefined);
  const [runKey, setRunKey] = useState(0);
  const index = open === null ? -1 : results.findIndex((h) => h.unit_id === open);
  const hit = index >= 0 ? results[index]! : null;

  function run(q: string, extra: { person?: string; min_faces?: number; limit?: number } = {}) {
    setQuery(q);
    setResults(searchMock(corpus, people, { query: q, ...extra }));
    setOpen(null);
  }

  function step(delta: number) {
    const next = results[Math.min(results.length - 1, Math.max(0, index + delta))];
    if (next) { setOpen(next.unit_id); setPlayhead(undefined); }
  }

  return (
    <AppShell current="search" title="Search" subtitle="Find the moment, not the file. Name a person and say what they are doing."
      units={units} snapshot={snapshot} onNavigate={onNavigate}>
      <SearchBar key={runKey} people={people} initialQuery={query} busy={loading}
        onSearch={(p) => run(p.query, { person: p.person || undefined, min_faces: p.min_faces, limit: p.limit })} />

      {!query && !loading && !error ? (
        <Panel as="section" title="Try a query">
          <div className="mm-chips">
            {EXAMPLES.map((q) => (
              <Button key={q} onClick={() => { run(q); setRunKey((k) => k + 1); }}>{q}</Button>
            ))}
          </div>
          <p className="mm-mono" style={{ margin: "12px 0 0" }}>A capitalised name filters to that person; the rest is matched against what is on screen.</p>
        </Panel>
      ) : (
        <ResultGrid hits={results} query={query} people={people} loading={loading} error={error}
          selectedId={open} onOpen={(h) => { setOpen(h.unit_id); setPlayhead(undefined); }} />
      )}

      {hit && (
        <div className="mm-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setOpen(null); }}>
          <PreviewPanel
            hit={hit} position={index + 1} total={results.length}
            frameSrc={hit.thumb_url ?? kitchenFrame}
            faces={hit.unit_id === 101 ? kitchenFaces.slice(0, 2) : []}
            people={people} annotations={hit.kind === "video" ? annotations : []} scenes={scenes} duration={duration}
            playhead={playhead} onSeek={setPlayhead}
            onPrev={() => step(-1)} onNext={() => step(1)} onClose={() => setOpen(null)}
            actions={onOpenClip && hit.kind !== "document" ? <Button variant="primary" onClick={() => onOpenClip(hit)}>Open clip</Button> : undefined}
          />
        </div>
      )}
    </AppShell>
  );
}
