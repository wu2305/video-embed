import type { Face, Person } from "../types";
import { displayName } from "../lib/format";

export interface FaceOverlayProps {
  faces: readonly Face[];
  people?: readonly Person[];
  selectedIndex?: number | null;
  /** When set, boxes are buttons. Without it they are display-only. */
  onSelect?: (faceIndex: number) => void;
}

/** Absolutely positioned face boxes. Place inside a `position: relative` stage. */
export function FaceOverlay({ faces, people = [], selectedIndex = null, onSelect }: FaceOverlayProps) {
  return (
    <>
      {faces.map((face) => {
        const [x, y, w, h] = face.bbox;
        const label = face.person_id ? displayName(face.person_id, people) : "untagged";
        const cls = ["mm-face", face.person_id ? "" : "untagged", face.face_index === selectedIndex ? "selected" : "", onSelect ? "" : "static"]
          .filter(Boolean)
          .join(" ");
        const style = { left: `${x * 100}%`, top: `${y * 100}%`, width: `${w * 100}%`, height: `${h * 100}%` };
        const body = <span className="mm-face-label">{label}</span>;
        return onSelect ? (
          <button key={face.face_index} type="button" className={cls} style={style} aria-label={`Face ${face.face_index + 1}: ${label}`} aria-pressed={face.face_index === selectedIndex} onClick={() => onSelect(face.face_index)}>
            {body}
          </button>
        ) : (
          <div key={face.face_index} className={cls} style={style}>{body}</div>
        );
      })}
    </>
  );
}
