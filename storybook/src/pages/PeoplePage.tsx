import { useId, useState } from "react";
import type { Hit, Person } from "../types";
import { Button } from "../components/atoms/Button";
import { Panel } from "../components/atoms/Panel";
import { Tag } from "../components/atoms/Tag";
import { Field } from "../components/molecules/Field";
import { ResultCard } from "../components/molecules/ResultCard";
import { PeopleGrid } from "../components/organisms/PeopleGrid";
import type { PageId } from "../components/organisms/TopBar";
import { AppShell } from "../components/templates/AppShell";

export interface PeoplePageProps {
  people: readonly Person[];
  samples?: Readonly<Record<string, string>>;
  /** Hits used to list where the selected person appears. */
  corpus?: readonly Hit[];
  /** Select this cluster at load. */
  selectedId?: string | null;
  units?: number;
  snapshot?: string;
  onNavigate?: (page: PageId) => void;
  /** Called with the new name. The caller owns persistence (a future `POST /api/tag`). */
  onName?: (personId: string, name: string) => void;
}

/** Page: every person cluster, with a side panel to name the selected one and see where they appear. */
export function PeoplePage({ people: initial, samples = {}, corpus = [], selectedId = null, units, snapshot, onNavigate, onName }: PeoplePageProps) {
  const [people, setPeople] = useState<Person[]>(() => [...initial]);
  const [selected, setSelected] = useState<string | null>(selectedId);
  const [draft, setDraft] = useState(() => initial.find((p) => p.id === selectedId)?.name ?? "");
  const [saved, setSaved] = useState<string | null>(null);
  const listId = useId();

  const person = people.find((p) => p.id === selected) ?? null;
  const known = people.filter((p) => p.name && p.id !== selected).map((p) => p.name!);
  const merging = draft.trim() !== "" && known.includes(draft.trim());
  const appearances = person ? corpus.filter((h) => h.person_ids.includes(person.id)) : [];
  const unnamed = people.filter((p) => !p.name).length;

  function select(p: Person) {
    setSelected(p.id);
    setDraft(p.name ?? "");
    setSaved(null);
  }

  function apply(event: React.FormEvent) {
    event.preventDefault();
    const name = draft.trim();
    if (!person || !name) return;
    setPeople((list) => list.map((p) => (p.id === person.id ? { ...p, name } : p)));
    onName?.(person.id, name);
    setSaved(`Named ${person.faces} appearances “${name}”.`);
  }

  return (
    <AppShell current="people" title="People"
      subtitle={unnamed ? `${unnamed} of ${people.length} face clusters have no name yet. Name one and every appearance follows.` : "Every face cluster has a name."}
      units={units} snapshot={snapshot} onNavigate={onNavigate}>
      <div className="mm-split">
        <PeopleGrid people={people} samples={samples} selectedId={selected} onOpen={select} />
        <aside>
          {!person ? (
            <Panel as="section" title="Name a person">
              <p className="mm-mono" style={{ margin: 0 }}>Select a cluster to name it. Unnamed clusters show their id.</p>
            </Panel>
          ) : (
            <>
              <Panel as="section" title={person.name ?? person.id} aria-label="Selected person">
                <form onSubmit={apply} style={{ display: "grid", gap: 12 }}>
                  {samples[person.id] && (
                    <div className="mm-stage" style={{ maxWidth: 200 }}><img src={samples[person.id]} alt={`Sample face from ${person.id}`} /></div>
                  )}
                  <div className="mm-mono"><Tag>{person.id}</Tag><Tag>{person.faces} faces</Tag></div>
                  <Field label="name">
                    <input type="text" list={listId} value={draft} onChange={(e) => { setDraft(e.target.value); setSaved(null); }} placeholder="Full name" autoComplete="off" />
                  </Field>
                  <datalist id={listId}>{known.map((n) => <option key={n} value={n} />)}</datalist>
                  {merging && <p className="mm-mono" role="note" style={{ margin: 0 }}><Tag tone="warn">merge</Tag>“{draft.trim()}” already names another cluster. Both will become one person.</p>}
                  <div><Button variant="primary" type="submit" disabled={!draft.trim() || draft.trim() === person.name}>{person.name ? "Rename" : "Apply name"}</Button></div>
                  {saved && <p className="mm-mono" role="status" style={{ margin: 0 }}><Tag tone="good">saved</Tag>{saved}</p>}
                </form>
              </Panel>
              <Panel as="section" title={`Appears in ${appearances.length}`}>
                {appearances.length === 0 ? (
                  <p className="mm-mono" style={{ margin: 0 }}>No hits in this sample.</p>
                ) : (
                  <>
                    <div className="mm-grid" style={{ ["--card-min" as string]: "140px" }}>
                      {appearances.slice(0, 4).map((h, i) => <ResultCard key={h.unit_id} hit={h} rank={i + 1} people={people} compact />)}
                    </div>
                    {appearances.length > 4 && (
                      <p className="mm-mono" style={{ margin: "10px 0 0" }}>
                        and {appearances.length - 4} more. <a href="#search" onClick={(e) => { e.preventDefault(); onNavigate?.("search"); }}>Search for {person.name ?? person.id}</a>
                      </p>
                    )}
                  </>
                )}
              </Panel>
            </>
          )}
        </aside>
      </div>
    </AppShell>
  );
}
