/** Mirrors `SearchHit.to_dict()` in src/mmindex/search.py, plus fields the scenes propose. */
export type MediaKind = "video" | "image" | "audio" | "document";

export interface Hit {
  unit_id: number;
  path: string;
  score: number;
  similarity: number;
  text_bonus: number;
  kind: MediaKind;
  canonical_time: number;
  ocr_text: string;
  asr_text: string;
  person_ids: string[];
  face_count: number;
  is_master: boolean;
  unit_index: number;

  // --- proposed (not in SearchHit.to_dict() today) ---
  /** Scene range in seconds. Null for images and other still media. */
  scene_start?: number | null;
  scene_end?: number | null;
  /** Bonus from a user note, kept apart from the machine OCR/ASR bonus. */
  note_bonus?: number;
  /** Notes that overlap the scene. */
  notes?: string[];
  /** Which search API produced the hit. Absent means this index. */
  source?: string;
  /** Overrides `/api/thumb?id=` for hits from another API. */
  thumb_url?: string;
}

/** A person cluster, optionally named by a user (scene 1). */
export interface Person {
  id: string;
  name?: string;
  faces: number;
}

/** One detected face. `bbox` is [x, y, w, h], each normalised to 0..1 (scene 1). */
export interface Face {
  face_index: number;
  bbox: [number, number, number, number];
  person_id: string | null;
}

export type TagScope = "cluster" | "face";

export interface Annotation {
  id: string;
  t_start: number;
  t_end: number | null;
  text: string;
  author: string;
  person_ids: string[];
}

export interface Scene {
  start: number;
  end: number;
}

export interface ParsedQuery {
  who: string[];
  person_ids: string[];
  what: string;
  /** Names in the query that match no person. */
  unresolved: string[];
}
