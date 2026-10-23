import { useId, useRef, useState } from "react";
import type { Face, Person, TagScope } from "../../types";
import { Button } from "../atoms/Button";
import { Label } from "../atoms/Label";
import { Tag } from "../atoms/Tag";
import { Field } from "../molecules/Field";
import { FaceOverlay } from "./FaceOverlay";
import { useI18n } from "../../i18n";
import { useSubmitReason } from "../../lib/useSubmitReason";

export interface FaceTaggerProps {
  src: string;
  faces: readonly Face[];
  people: readonly Person[];
  /** Start with this face selected (by `face_index`) and this name typed, as after a click. */
  initialSelected?: number | null;
  initialName?: string;
  /** Called when the user confirms. The caller owns persistence (a future `POST /api/tag`). */
  onTag?: (tag: FaceTag) => void;
  /** Called when the user undoes a merge they just confirmed. */
  onUndoTag?: (tag: FaceTag) => void;
}

export interface FaceTag { face_index: number; name: string; scope: TagScope }

/** Scene 1: click a face box, name it, choose whether the name covers the whole cluster. */
export function FaceTagger({ src, faces, people, initialSelected = null, initialName = "", onTag, onUndoTag }: FaceTaggerProps) {
  const { t, rich } = useI18n();
  const [selected, setSelected] = useState<number | null>(initialSelected);
  const [name, setName] = useState(initialName);
  const [scope, setScope] = useState<TagScope>(() => (faces.find((f) => f.face_index === initialSelected)?.person_id === null ? "face" : "cluster"));
  const [applied, setApplied] = useState<{ tone: "good" | "warn"; label: string; text: string; undo?: FaceTag } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const nameId = useId();

  const face = faces.find((f) => f.face_index === selected) ?? null;
  const cluster = face?.person_id ? people.find((p) => p.id === face.person_id) : undefined;
  const known = people.filter((p) => p.name).map((p) => p.name!);
  const merging = name.trim() !== "" && known.includes(name.trim()) && cluster?.name !== name.trim();
  const target = merging ? people.find((p) => p.name === name.trim()) : undefined;
  // What moves into the target: the whole cluster, or just this face.
  const moving = scope === "cluster" && cluster ? { label: cluster.id, faces: cluster.faces } : { label: t("face.thisFace"), faces: 1 };
  const { blocked, buttonProps, why } = useSubmitReason(name.trim() ? null : t("face.reason.empty"), () => nameRef.current);

  function select(index: number) {
    const next = faces.find((f) => f.face_index === index);
    setSelected(index);
    setName(people.find((p) => p.id === next?.person_id)?.name ?? "");
    setScope(next?.person_id ? "cluster" : "face");
    setApplied(null);
    setConfirming(false);
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!face || blocked()) return;
    // Reusing a name merges two people for everyone: that needs its own confirmation, as on the People page.
    if (target) { setConfirming(true); return; }
    apply();
  }

  function apply() {
    if (!face) return;
    const tag = { face_index: face.face_index, name: name.trim(), scope };
    onTag?.(tag);
    setConfirming(false);
    if (target) setApplied({ tone: "good", label: t("people.merged"), text: t("face.mergedText", { from: moving.label, name: tag.name, faces: moving.faces + target.faces }), undo: tag });
    else setApplied({ tone: "good", label: t("face.saved"), text: scope === "cluster" && cluster ? t("face.namedAll", { faces: cluster.faces, name: tag.name }) : t("face.namedOne", { name: tag.name }) });
  }

  function undo(tag: FaceTag) {
    onUndoTag?.(tag);
    setApplied({ tone: "warn", label: t("people.undone"), text: t("face.undoneText", { from: moving.label }) });
  }

  return (
    <div className="mm-tagger">
      <div className="mm-stage">
        <img src={src} alt="Keyframe with detected faces" />
        <FaceOverlay faces={faces} people={people} selectedIndex={selected} onSelect={select} />
      </div>
      <form className="mm-panel" onSubmit={submit} aria-label={t("face.tagForm")}>
        {!face ? (
          <p className="mm-hint">{t("face.hint")}</p>
        ) : (
          <>
            <Field label={t("face.name")}>
              <input id={nameId} ref={nameRef} type="text" list={listId} value={name} onChange={(e) => { setName(e.target.value); setConfirming(false); setApplied(null); }} placeholder="Ana Ruiz" autoComplete="off" />
            </Field>
            <datalist id={listId}>{known.map((n) => <option key={n} value={n} />)}</datalist>
            <fieldset style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: 8 }}>
              <legend><Label as="span">{t("face.applyTo")}</Label></legend>
              <label className="mm-radio">
                <input type="radio" name="scope" checked={scope === "cluster"} disabled={!cluster} onChange={() => setScope("cluster")} />
                <span>{t("face.all")}{cluster && <small>{cluster.id} · {cluster.faces} faces</small>}{!cluster && <small>{t("face.needsCluster")}</small>}</span>
              </label>
              <label className="mm-radio">
                <input type="radio" name="scope" checked={scope === "face"} onChange={() => setScope("face")} />
                <span>{t("face.thisOnly")}<small>{t("face.correct")}</small></span>
              </label>
            </fieldset>
            {merging && <p className="mm-hint" role="note"><Tag tone="warn">{t("face.merge")}</Tag>“{name.trim()}” {t("face.mergeWarn")}</p>}
            {target && confirming ? (
              <div className="mm-confirm" role="group" aria-label={t("people.confirmGroup")}>
                <p role="alert" style={{ margin: 0 }}>
                  {rich("merge.confirm", { from: <b>{moving.label}</b>, fromFaces: moving.faces, to: <b>{target.id}</b>, name: target.name, toFaces: target.faces, total: moving.faces + target.faces })}
                </p>
                <div className="mm-row">
                  <Button variant="danger" onClick={apply}>{t("people.confirm")}</Button>
                  <Button variant="ghost" onClick={() => setConfirming(false)}>{t("people.cancel")}</Button>
                </div>
              </div>
            ) : target ? (
              <Button variant="danger" type="submit">{t("people.mergeInto", { name: target.name ?? target.id })}</Button>
            ) : (
              <Button variant="primary" type="submit" {...buttonProps}>{t("face.apply")}</Button>
            )}
            {why}
            {applied && (
              <p className="mm-hint mm-saved" role="status">
                <Tag tone={applied.tone}>{applied.label}</Tag>{applied.text}
                {applied.undo && <> <Button onClick={() => undo(applied.undo!)}>{t("people.undo")}</Button></>}
              </p>
            )}
          </>
        )}
      </form>
    </div>
  );
}
