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

/**
 * Faces whose labels would overlap: labels sit above each box, so two boxes
 * close together in both x and y collide. The right-hand one moves below.
 * Thresholds are shares of the frame, sized for an 8–12 character label.
 */
function labelsBelow(faces: readonly Face[]): Set<number> {
  const below = new Set<number>();
  const above: Face[] = [];
  for (const face of [...faces].sort((a, b) => a.bbox[0] - b.bbox[0])) {
    const [x, y] = face.bbox;
    if (above.some((o) => x - o.bbox[0] < 0.14 && Math.abs(y - o.bbox[1]) < 0.08)) below.add(face.face_index);
    else above.push(face);
  }
  return below;
}

/** Absolutely positioned face boxes. Place inside a `position: relative` stage. */
export function FaceOverlay({ faces, people = [], selectedIndex = null, onSelect }: FaceOverlayProps) {
  const below = labelsBelow(faces);
  return (
    <>
      {faces.map((face) => (
        <FaceBox key={face.face_index} face={face} label={face.person_id ? displayName(face.person_id, people) : "untagged"}
          selected={face.face_index === selectedIndex} labelBelow={below.has(face.face_index)} onSelect={onSelect} />
      ))}
    </>
  );
}
