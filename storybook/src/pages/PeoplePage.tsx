import { useId, useRef, useState } from "react";
import type { Hit, IndexInfo, Person, Viewer } from "../types";
import { Button } from "../components/atoms/Button";
import { Panel } from "../components/atoms/Panel";
import { Tag } from "../components/atoms/Tag";
import { Field } from "../components/molecules/Field";
import { ResultCard } from "../components/molecules/ResultCard";
import { PeopleGrid } from "../components/organisms/PeopleGrid";
import type { PageId } from "../components/organisms/TopBar";
import { AppShell } from "../components/templates/AppShell";
import { useI18n } from "../i18n";
import { useSubmitReason } from "../lib/useSubmitReason";

export interface PeoplePageProps {
  people: readonly Person[];
  samples?: Readonly<Record<string, string>>;
  /** Hits used to list where the selected person appears. */
  corpus?: readonly Hit[];
  /** Select this cluster at load. */
  selectedId?: string | null;
  /** Faces from recent nights that matched no person; they wait for the next full regroup. */
  pendingFaces?: number;
  index?: IndexInfo;
  now?: number;
  viewer?: Viewer;
  onNavigate?: (page: PageId) => void;
  /** Called with the new name. The caller owns persistence (a future `POST /api/tag`). */
  onName?: (personId: string, name: string) => void;
  /** Called once a merge is confirmed: every appearance of `fromId` joins `intoId`. */
  onMerge?: (fromId: string, intoId: string) => void;
  /** Called when the user undoes the merge they just made. */
  onUndoMerge?: (fromId: string, intoId: string) => void;
}

interface Saved {
  text: string;
  tone: "good" | "warn";
  label: string;
  /** Set right after a merge: what Undo puts back. */
  undo?: { people: Person[]; merged: Record<string, string>; from: Person; into: Person };
}

/**
 * Page: every person cluster the viewer can see, with a side panel to name the
 * selected one and see where they appear. Counts cover only files the viewer
 * may open, so two users can see different numbers for the same person.
 */
export function PeoplePage({
  people: initial, samples = {}, corpus = [], selectedId = null, pendingFaces = 0, index, now, viewer, onNavigate, onName, onMerge, onUndoMerge,
}: PeoplePageProps) {
  const { t, rich } = useI18n();
  const [people, setPeople] = useState<Person[]>(() => [...initial]);
  const [selected, setSelected] = useState<string | null>(selectedId);
  const [draft, setDraft] = useState(() => initial.find((p) => p.id === selectedId)?.name ?? "");
  const [saved, setSaved] = useState<Saved | null>(null);
  const [confirming, setConfirming] = useState(false);
  /** Clusters merged away, by id, mapped to the person they joined. */
  const [merged, setMerged] = useState<Record<string, string>>({});
  const listId = useId();
  const nameRef = useRef<HTMLInputElement>(null);

  const person = people.find((p) => p.id === selected) ?? null;
  const known = people.filter((p) => p.name && p.id !== selected).map((p) => p.name!);
  const target = draft.trim() === "" ? null : people.find((p) => p.id !== selected && p.name === draft.trim()) ?? null;
  const owner = (id: string) => merged[id] ?? id;
  const appearances = person ? corpus.filter((h) => h.person_ids.some((id) => owner(id) === person.id)) : [];
  // Merged-away ids still appear on hits; show them under the name they joined.
  const shown = [...people, ...Object.entries(merged).map(([id, into]) => ({ id, name: people.find((p) => p.id === into)?.name, faces: 0 }))];
  const unnamed = people.filter((p) => !p.name).length;
  const reason = !person ? null : !draft.trim() ? t("people.reason.empty") : draft.trim() === person.name ? t("people.reason.same") : null;
  const { blocked, buttonProps, why } = useSubmitReason(reason, () => nameRef.current);

  function select(p: Person) {
    setSelected(p.id);
    setDraft(p.name ?? "");
    setSaved(null);
    setConfirming(false);
  }

  function apply(event: React.FormEvent) {
    event.preventDefault();
    const name = draft.trim();
    if (!person || blocked()) return;
    // Reusing a name merges two people: that needs its own confirmation.
    if (target) { setConfirming(true); return; }
    setPeople((list) => list.map((p) => (p.id === person.id ? { ...p, name } : p)));
    onName?.(person.id, name);
    setSaved({ tone: "good", label: t("people.saved"), text: t("people.namedText", { faces: person.faces, name }) });
  }

  function merge() {
    if (!person || !target) return;
    const undo = { people, merged, from: person, into: target };
    const faces = person.faces + target.faces;
    setPeople((list) => list.filter((p) => p.id !== person.id).map((p) => (p.id === target.id ? { ...p, faces } : p)));
    setMerged((m) => ({ ...Object.fromEntries(Object.entries(m).map(([id, into]) => [id, into === person.id ? target.id : into])), [person.id]: target.id }));
    onMerge?.(person.id, target.id);
    setConfirming(false);
    setSelected(target.id);
    setDraft(target.name ?? "");
    setSaved({ tone: "good", label: t("people.merged"), text: t("people.mergedText", { id: person.id, target: target.name ?? target.id, faces }), undo });
  }

  function undoMerge(undo: NonNullable<Saved["undo"]>) {
    setPeople(undo.people);
    setMerged(undo.merged);
    onUndoMerge?.(undo.from.id, undo.into.id);
    setSelected(undo.from.id);
    setDraft(undo.from.name ?? "");
    setSaved({ tone: "warn", label: t("people.undone"), text: t("people.undoneText", { id: undo.from.id }) });
  }

  return (
    <AppShell current="people" title={t("people.title")}
      subtitle={unnamed ? t("people.unnamedCount", { unnamed, total: people.length }) : undefined}
      index={index} now={now} viewer={viewer} onNavigate={onNavigate}>
      {pendingFaces > 0 && (
        <div className="mm-notice" role="note">
          {t("people.pending", { count: pendingFaces })}
        </div>
      )}
      <div className="mm-split">
        <PeopleGrid people={people} samples={samples} selectedId={selected} onOpen={select} />
        <aside>
          {!person ? (
            <Panel as="section" title={t("people.nameHeading")}>
              <p className="mm-hint" style={{ margin: 0 }}>{t("people.nameHint")}</p>
            </Panel>
          ) : (
            <>
              <Panel as="section" title={person.name ?? person.id} aria-label={t("people.selected")}>
                <form onSubmit={apply} style={{ display: "grid", gap: 12 }}>
                  {samples[person.id] && (
                    <div className="mm-stage" style={{ maxWidth: 200 }}><img src={samples[person.id]} alt={t("people.sampleFace", { id: person.id })} /></div>
                  )}
                  <div className="mm-mono"><Tag>{person.id}</Tag><Tag>{person.faces} faces</Tag></div>
                  <Field label={t("people.nameField")}>
                    <input ref={nameRef} type="text" list={listId} value={draft} onChange={(e) => { setDraft(e.target.value); setSaved(null); setConfirming(false); }} placeholder={t("people.fullName")} autoComplete="off" />
                  </Field>
                  <datalist id={listId}>{known.map((n) => <option key={n} value={n} />)}</datalist>
                  {target && <p className="mm-hint" role="note" style={{ margin: 0 }}><Tag tone="warn">{t("face.merge")}</Tag>{t("people.mergeWarn", { name: target.name ?? target.id, id: target.id })}</p>}
                  {target && confirming ? (
                    <div className="mm-confirm" role="group" aria-label={t("people.confirmGroup")}>
                      <p role="alert" style={{ margin: 0 }}>
                        {rich("merge.confirm", { from: <b>{person.id}</b>, fromFaces: person.faces, to: <b>{target.id}</b>, name: target.name, toFaces: target.faces, total: person.faces + target.faces })}
                      </p>
                      <div className="mm-row">
                        <Button variant="danger" onClick={merge}>{t("people.confirm")}</Button>
                        <Button variant="ghost" onClick={() => setConfirming(false)}>{t("people.cancel")}</Button>
                      </div>
                    </div>
                  ) : target ? (
                    <div><Button variant="danger" type="submit">{t("people.mergeInto", { name: target.name ?? target.id })}</Button></div>
                  ) : (
                    <div><Button variant="primary" type="submit" {...buttonProps}>{person.name ? t("people.rename") : t("people.applyName")}</Button></div>
                  )}
                  {!target && why}
                  {saved && (
                    <p className="mm-hint mm-saved" role="status" style={{ margin: 0 }}>
                      <Tag tone={saved.tone}>{saved.label}</Tag>{saved.text}
                      {saved.undo && <> <Button onClick={() => undoMerge(saved.undo!)}>{t("people.undo")}</Button></>}
                    </p>
                  )}
                </form>
              </Panel>
              <Panel as="section" title={t("people.appears", { count: appearances.length })}>
                {appearances.length === 0 ? (
                  <p className="mm-hint" style={{ margin: 0 }}>{t("people.noHits")}</p>
                ) : (
                  <>
                    <div className="mm-grid" style={{ ["--card-min" as string]: "140px" }}>
                      {appearances.slice(0, 4).map((h, i) => <ResultCard key={h.unit_id} hit={h} rank={i + 1} people={shown} compact />)}
                    </div>
                    {appearances.length > 4 && (
                      <p className="mm-hint" style={{ margin: "10px 0 0" }}>
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
