import type { Hit, Person } from "../types";
import { parseQuery } from "../lib/parseQuery";

export interface Filters {
  query: string;
  person?: string;
  min_faces?: number;
  limit?: number;
}

/**
 * Stand-in for `/api/search` over mock hits: a named person or the person
 * filter must appear in the hit, and the face floor applies. Ranking is the
 * mock score, so the order is stable.
 */
export function searchMock(corpus: readonly Hit[], people: readonly Person[], f: Filters): Hit[] {
  const parsed = parseQuery(f.query, people);
  const wanted = parsed.person_ids.length ? parsed.person_ids : f.person ? [f.person] : [];
  return corpus
    .filter((h) => wanted.every((id) => h.person_ids.includes(id)))
    .filter((h) => h.face_count >= (f.min_faces ?? 0))
    .sort((a, b) => b.score - a.score)
    .slice(0, f.limit ?? 12);
}
