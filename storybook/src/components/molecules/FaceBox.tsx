import type { Face } from "../../types";

/** Where a label sits: above or below its box, aligned to the box's left or right edge. */
export type LabelPlace = "above" | "above-end" | "below" | "below-end";

export interface FaceBoxProps {
  face: Face;
  label: string;
  selected?: boolean;
  /** Where the label sits, when the default (above, left-aligned) would cover another label or face. */
  labelPlace?: LabelPlace;
  /** When set, the box is a button. Otherwise it is display-only. */
  onSelect?: (faceIndex: number) => void;
}

/** One face rectangle. Position it inside a `position: relative` stage; bbox is normalised 0..1. */
export function FaceBox({ face, label, selected = false, labelPlace = "above", onSelect }: FaceBoxProps) {
  const [x, y, w, h] = face.bbox;
  const cls = ["mm-face", face.person_id ? "" : "untagged", selected ? "selected" : "", onSelect ? "" : "static", labelPlace.startsWith("below") ? "label-below" : "", labelPlace.endsWith("end") ? "label-end" : ""].filter(Boolean).join(" ");
  const style = { left: `${x * 100}%`, top: `${y * 100}%`, width: `${w * 100}%`, height: `${h * 100}%` };
  const body = <span className="mm-face-label">{label}</span>;
  return onSelect ? (
    <button type="button" className={cls} style={style} data-face={face.face_index} aria-label={`Face ${face.face_index + 1}: ${label}`} aria-pressed={selected} onClick={() => onSelect(face.face_index)}>
      {body}
    </button>
  ) : (
    <div className={cls} style={style} data-face={face.face_index}>{body}</div>
  );
}
