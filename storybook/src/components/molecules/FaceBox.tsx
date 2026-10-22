import type { Face } from "../../types";

export interface FaceBoxProps {
  face: Face;
  label: string;
  selected?: boolean;
  /** Put the label under the box, when another label would cover it. */
  labelBelow?: boolean;
  /** When set, the box is a button. Otherwise it is display-only. */
  onSelect?: (faceIndex: number) => void;
}

/** One face rectangle. Position it inside a `position: relative` stage; bbox is normalised 0..1. */
export function FaceBox({ face, label, selected = false, labelBelow = false, onSelect }: FaceBoxProps) {
  const [x, y, w, h] = face.bbox;
  const cls = ["mm-face", face.person_id ? "" : "untagged", selected ? "selected" : "", onSelect ? "" : "static", labelBelow ? "label-below" : ""].filter(Boolean).join(" ");
  const style = { left: `${x * 100}%`, top: `${y * 100}%`, width: `${w * 100}%`, height: `${h * 100}%` };
  const body = <span className="mm-face-label">{label}</span>;
  return onSelect ? (
    <button type="button" className={cls} style={style} aria-label={`Face ${face.face_index + 1}: ${label}`} aria-pressed={selected} onClick={() => onSelect(face.face_index)}>
      {body}
    </button>
  ) : (
    <div className={cls} style={style}>{body}</div>
  );
}
