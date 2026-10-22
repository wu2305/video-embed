import { useId, useState } from "react";
import type { Face, Person, TagScope } from "../../types";
import { Button } from "../atoms/Button";
import { Label } from "../atoms/Label";
import { Tag } from "../atoms/Tag";
import { Field } from "../molecules/Field";
import { FaceOverlay } from "./FaceOverlay";

export interface FaceTaggerProps {
  src: string;
  faces: readonly Face[];
  people: readonly Person[];
  /** Called when the user confirms. The caller owns persistence (a future `POST /api/tag`). */
  onTag?: (tag: { face_index: number; name: string; scope: TagScope }) => void;
}

/** Scene 1: click a face box, name it, choose whether the name covers the whole cluster. */
export function FaceTagger({ src, faces, people, onTag }: FaceTaggerProps) {
  const [selected, setSelected] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [scope, setScope] = useState<TagScope>("cluster");
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
    setApplied(scope === "cluster" && cluster ? `Named ${cluster.faces} appearances “${name.trim()}”.` : `Named this face “${name.trim()}”.`);
  }

  return (
    <div className="mm-tagger">
      <div className="mm-stage">
        <img src={src} alt="Keyframe with detected faces" />
        <FaceOverlay faces={faces} people={people} selectedIndex={selected} onSelect={select} />
      </div>
      <form className="mm-panel" onSubmit={submit} aria-label="Tag face">
        {!face ? (
          <p className="mm-hint">Select a face box to name it. Dashed boxes have no cluster yet.</p>
        ) : (
          <>
            <Field label="name">
              <input id={nameId} type="text" list={listId} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ana Ruiz" autoComplete="off" />
            </Field>
            <datalist id={listId}>{known.map((n) => <option key={n} value={n} />)}</datalist>
            <fieldset style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: 8 }}>
              <legend><Label as="span">apply to</Label></legend>
              <label className="mm-radio">
                <input type="radio" name="scope" checked={scope === "cluster"} disabled={!cluster} onChange={() => setScope("cluster")} />
                <span>All appearances{cluster && <small>{cluster.id} · {cluster.faces} faces</small>}{!cluster && <small>needs a cluster</small>}</span>
              </label>
              <label className="mm-radio">
                <input type="radio" name="scope" checked={scope === "face"} onChange={() => setScope("face")} />
                <span>This face only<small>use to correct a wrong cluster</small></span>
              </label>
            </fieldset>
            {merging && <p className="mm-hint" role="note"><Tag tone="warn">merge</Tag>“{name.trim()}” already names another cluster. Both will become one person.</p>}
            <Button variant="primary" type="submit" disabled={!name.trim()}>Apply name</Button>
            {applied && <p className="mm-hint" role="status"><Tag tone="good">saved</Tag>{applied}</p>}
          </>
        )}
      </form>
    </div>
  );
}
