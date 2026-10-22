import { useLayoutEffect, useRef, useState } from "react";
import type { Face, Person } from "../../types";
import { displayName } from "../../lib/format";
import { FaceBox, type LabelPlace } from "../molecules/FaceBox";

export interface FaceOverlayProps {
  faces: readonly Face[];
  people?: readonly Person[];
  selectedIndex?: number | null;
  /** When set, boxes are buttons. Without it they are display-only. */
  onSelect?: (faceIndex: number) => void;
}

interface Rect { left: number; top: number; right: number; bottom: number }

const PLACES: readonly LabelPlace[] = ["above", "above-end", "below", "below-end"];

/** Area two rectangles share. */
function overlap(a: Rect, b: Rect): number {
  const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * First guess, before anything is measured: labels sit above each box, so two
 * boxes close together in both x and y collide and the right-hand one moves
 * below. Thresholds are shares of the frame, sized for a wide stage.
 */
function guess(faces: readonly Face[]): Map<number, LabelPlace> {
  const place = new Map<number, LabelPlace>();
  const above: Face[] = [];
  for (const face of [...faces].sort((a, b) => a.bbox[0] - b.bbox[0])) {
    const [x, y] = face.bbox;
    if (above.some((o) => x - o.bbox[0] < 0.14 && Math.abs(y - o.bbox[1]) < 0.08)) place.set(face.face_index, "below");
    else { place.set(face.face_index, "above"); above.push(face); }
  }
  return place;
}

/** Up to this many faces every combination is tried; beyond it, one greedy pass. */
const EXHAUSTIVE = 6;

/**
 * From the rendered boxes and labels: picks a place for every label so that
 * labels cover no other label, no other face and stay inside the stage. Label
 * size does not depend on where it sits, so the current layout is enough.
 * Ties keep the earlier place, so a label stays above its box when it can.
 */
function measure(root: HTMLElement): Map<number, LabelPlace> {
  const stage = root.getBoundingClientRect();
  const faces = [...root.querySelectorAll<HTMLElement>("[data-face]")].map((el) => {
    const label = el.querySelector<HTMLElement>(".mm-face-label")!;
    return { index: Number(el.dataset.face), box: el.getBoundingClientRect() as Rect, w: label.offsetWidth, h: label.offsetHeight };
  });
  const rect = (i: number, place: LabelPlace): Rect => {
    const { box, w, h } = faces[i]!;
    const left = place.endsWith("end") ? box.right + 2 - w : box.left - 2;
    const top = place.startsWith("above") ? box.top - 2 - h : box.bottom + 2;
    return { left, right: left + w, top, bottom: top + h };
  };
  // Cost of one label: the faces it covers, and how much of it the stage clips.
  const own = (i: number, r: Rect) => {
    const inside = overlap(r, stage);
    return faces.reduce((sum, o, j) => (j === i ? sum : sum + overlap(r, o.box)), 0) + (r.right - r.left) * (r.bottom - r.top) - inside;
  };
  const cost = (places: readonly LabelPlace[]) => {
    const rects = places.map((p, i) => rect(i, p));
    let total = 0;
    rects.forEach((r, i) => {
      total += own(i, r);
      for (let j = 0; j < i; j++) total += overlap(r, rects[j]!);
    });
    return total;
  };

  let best: LabelPlace[] = faces.map(() => "above");
  if (faces.length <= EXHAUSTIVE) {
    let bestCost = Infinity;
    for (let n = 0; n < PLACES.length ** faces.length && bestCost > 0; n++) {
      const places = faces.map((_, i) => PLACES[Math.floor(n / PLACES.length ** i) % PLACES.length]!);
      const c = cost(places);
      if (c < bestCost) { bestCost = c; best = places; }
    }
  } else {
    faces.forEach((_, i) => {
      let bestCost = Infinity;
      for (const place of PLACES) {
        const c = cost([...best.slice(0, i), place]);
        if (c < bestCost) { bestCost = c; best[i] = place; }
      }
    });
  }
  return new Map(faces.map((f, i) => [f.index, best[i]!]));
}

const same = (a: Map<number, LabelPlace>, b: Map<number, LabelPlace>) => a.size === b.size && [...a].every(([i, p]) => b.get(i) === p);

/**
 * Absolutely positioned face boxes. Place inside a `position: relative` stage.
 * Labels that would collide move below their box or to its right edge; this
 * is re-checked whenever the stage resizes, so narrow stages are handled too.
 */
export function FaceOverlay({ faces, people = [], selectedIndex = null, onSelect }: FaceOverlayProps) {
  const root = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState(() => guess(faces));

  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const update = () => {
      const next = measure(el);
      setPlace((prev) => (same(prev, next) ? prev : next));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [faces, people]);

  return (
    <div className="mm-faces" ref={root}>
      {faces.map((face) => (
        <FaceBox key={face.face_index} face={face} label={face.person_id ? displayName(face.person_id, people) : "untagged"}
          selected={face.face_index === selectedIndex} labelPlace={place.get(face.face_index)} onSelect={onSelect} />
      ))}
    </div>
  );
}
