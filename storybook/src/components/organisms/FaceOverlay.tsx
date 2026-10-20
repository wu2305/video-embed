import type { Face, Person } from "../../types";
import { displayName } from "../../lib/format";
import { FaceBox } from "../molecules/FaceBox";

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
      {faces.map((face) => (
        <FaceBox key={face.face_index} face={face} label={face.person_id ? displayName(face.person_id, people) : "untagged"} selected={face.face_index === selectedIndex} onSelect={onSelect} />
      ))}
    </>
  );
}
