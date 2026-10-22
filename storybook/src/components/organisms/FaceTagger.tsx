import { useId, useState } from "react";
import type { Face, Person, TagScope } from "../../types";
import { Button } from "../atoms/Button";
import { Label } from "../atoms/Label";
import { Tag } from "../atoms/Tag";
import { Field } from "../molecules/Field";
import { FaceOverlay } from "./FaceOverlay";
import { useI18n } from "../../i18n";

export interface FaceTaggerProps {
  src: string;
  faces: readonly Face[];
  people: readonly Person[];
  /** Start with this face selected (by `face_index`) and this name typed, as after a click. */
  initialSelected?: number | null;
  initialName?: string;
  /** Called when the user confirms. The caller owns persistence (a future `POST /api/tag`). */
  onTag?: (tag: { face_index: number; name: string; scope: TagScope }) => void;
}

/** Scene 1: click a face box, name it, choose whether the name covers the whole cluster. */
export function FaceTagger({ src, faces, people, initialSelected = null, initialName = "", onTag }: FaceTaggerProps) {
  const { t } = useI18n();
  const [selected, setSelected] = useState<number | null>(initialSelected);
  const [name, setName] = useState(initialName);
  const [scope, setScope] = useState<TagScope>(() => (faces.find((f) => f.face_index === initialSelected)?.person_id === null ? "face" : "cluster"));
  const [applied, setApplied] = useState<string | null>(null);
  const listId = useId();
  const nameId = useId();

  const face = faces.find((f) => f.face_index === selected) ?? null;
  const cluster = face?.person_id ? people.find((p) => p.id === face.person_id) : undefined;
  const known = people.filter((p) => p.name).map((p) => p.name!);
  const merging = name.trim() !== "" && known.includes(name.trim()) && cluster?.name !== name.trim();

  function select(index: number) {
    const next = faces.find((f) => f.face_index === index);
    setSelected(index);
    setName(people.find((p) => p.id === next?.person_id)?.name ?? "");
    setScope(next?.person_id ? "cluster" : "face");
    setApplied(null);
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!face || !name.trim()) return;
    onTag?.({ face_index: face.face_index, name: name.trim(), scope });
    setApplied(scope === "cluster" && cluster ? t("face.namedAll", { faces: cluster.faces, name: name.trim() }) : t("face.namedOne", { name: name.trim() }));
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
              <input id={nameId} type="text" list={listId} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ana Ruiz" autoComplete="off" />
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
            <Button variant="primary" type="submit" disabled={!name.trim()}>{t("face.apply")}</Button>
            {applied && <p className="mm-hint" role="status"><Tag tone="good">{t("face.saved")}</Tag>{applied}</p>}
          </>
        )}
      </form>
    </div>
  );
}
