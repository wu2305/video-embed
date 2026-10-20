import type { Annotation, Face, Hit, Person, Scene } from "../types";
import kitchenFrame from "../assets/kitchen.jpg";
import meetingFrame from "../assets/meeting.jpg";
import picnicFrame from "../assets/picnic.jpg";
import externalFrame from "../assets/external.jpg";

export { kitchenFrame, meetingFrame, picnicFrame };

export const people: Person[] = [
  { id: "person-0003", name: "Ana Ruiz", faces: 212 },
  { id: "person-0007", name: "Ben Okafor", faces: 96 },
  { id: "person-0011", faces: 41 },
  { id: "person-0019", faces: 17 },
];

/** Boxes are drawn by hand on the photos in `src/assets/`, so overlays line up with real faces. */
export const kitchenFaces: Face[] = [
  { face_index: 0, bbox: [0.4, 0.26, 0.11, 0.15], person_id: "person-0003" },
  { face_index: 1, bbox: [0.69, 0.16, 0.08, 0.13], person_id: "person-0007" },
  { face_index: 2, bbox: [0.28, 0.23, 0.09, 0.13], person_id: "person-0011" },
  { face_index: 3, bbox: [0.9, 0.27, 0.09, 0.12], person_id: null },
];

export const meetingFaces: Face[] = [
  { face_index: 0, bbox: [0.25, 0.07, 0.1, 0.15], person_id: "person-0007" },
  { face_index: 1, bbox: [0.57, 0.11, 0.1, 0.13], person_id: null },
  { face_index: 2, bbox: [0.8, 0.06, 0.1, 0.14], person_id: "person-0011" },
  { face_index: 3, bbox: [0.14, 0.4, 0.13, 0.15], person_id: "person-0003" },
];

export const picnicFaces: Face[] = [
  { face_index: 0, bbox: [0.36, 0.48, 0.09, 0.15], person_id: "person-0003" },
  { face_index: 1, bbox: [0.81, 0.46, 0.07, 0.13], person_id: "person-0011" },
];

const base = {
  text_bonus: 0,
  ocr_text: "",
  asr_text: "",
  person_ids: [] as string[],
  face_count: 0,
  is_master: true,
  unit_index: 0,
  canonical_time: 1_730_000_000,
};

function hit(unit_id: number, patch: Partial<Hit> & Pick<Hit, "path" | "kind" | "score" | "similarity">): Hit {
  return { ...base, unit_id, ...patch };
}

export const cookingHit = hit(101, {
  path: "/media/2025/cooking_class_03.mp4",
  kind: "video",
  score: 0.412,
  similarity: 0.362,
  text_bonus: 0.05,
  note_bonus: 0.05,
  face_count: 4,
  person_ids: ["person-0003", "person-0007", "person-0011"],
  unit_index: 4,
  scene_start: 42,
  scene_end: 71,
  asr_text: "now fold the garlic into the butter and let it soften",
  notes: ["Ana demonstrates the garlic butter"],
  thumb_url: kitchenFrame,
});

export const presentingHit = hit(102, {
  path: "/media/2025/q3_review.mp4",
  kind: "video",
  score: 0.337,
  similarity: 0.337,
  face_count: 4,
  person_ids: ["person-0003", "person-0007", "person-0011"],
  unit_index: 9,
  scene_start: 72,
  scene_end: 100,
  ocr_text: "Q3 BUDGET — headcount and spend",
  thumb_url: meetingFrame,
});

export const photoHit = hit(103, {
  path: "/media/2024/park_picnic.jpg",
  kind: "image",
  score: 0.298,
  similarity: 0.298,
  face_count: 2,
  person_ids: ["person-0003", "person-0011"],
  scene_start: null,
  scene_end: null,
  thumb_url: picnicFrame,
});

export const copyHit = hit(104, {
  path: "/media/backup/cooking_class_03 (1).mp4",
  kind: "video",
  score: 0.41,
  similarity: 0.36,
  is_master: false,
  face_count: 4,
  person_ids: ["person-0003", "person-0007", "person-0011"],
  scene_start: 42,
  scene_end: 71,
  thumb_url: kitchenFrame,
});

export const audioHit = hit(105, {
  path: "/media/2023/interview_ana.m4a",
  kind: "audio",
  score: 0.281,
  similarity: 0.231,
  text_bonus: 0.05,
  asr_text: "I started cooking when I was nine, mostly bread",
  scene_start: 120,
  scene_end: 148,
  person_ids: ["person-0003"],
});

export const documentHit = hit(106, {
  path: "/media/docs/recipe_notes.pdf",
  kind: "document",
  score: 0.266,
  similarity: 0.216,
  text_bonus: 0.05,
  ocr_text: "Garlic butter: 4 cloves, 80 g butter, rest 10 min",
});

export const externalHit = hit(201, {
  path: "https://catalog.example.com/assets/8841",
  kind: "video",
  score: 0.88,
  similarity: 0.88,
  source: "ProductSearch",
  scene_start: 5,
  scene_end: 19,
  thumb_url: externalFrame,
});

/** Faces drawn on each hit's frame, keyed by unit id. */
export const facesByUnit: Record<number, Face[]> = { 101: kitchenFaces, 102: meetingFaces, 103: picnicFaces, 104: kitchenFaces };

export const hits: Hit[] = [cookingHit, presentingHit, photoHit, copyHit];

/** A 3-minute clip cut into scenes, used by the track and preview stories. */
export const duration = 180;
export const scenes: Scene[] = [
  { start: 0, end: 18 }, { start: 18, end: 42 }, { start: 42, end: 71 },
  { start: 71, end: 104 }, { start: 104, end: 139 }, { start: 139, end: 180 },
];

export const annotations: Annotation[] = [
  { id: "n1", t_start: 44, t_end: 60, text: "Ana demonstrates the garlic butter", author: "mei", person_ids: ["person-0003"] },
  { id: "n2", t_start: 72, t_end: 100, text: "Ana is presenting the Q3 budget", author: "mei", person_ids: ["person-0003"] },
  { id: "n3", t_start: 118, t_end: null, text: "Camera shake from here", author: "mei", person_ids: [] },
];
