import type { ParsedQuery, Person } from "../types";

/**
 * Rule-based "<who> is/are <what>" splitter (scene 3).
 *
 * A prototype for the story: it only recognises names that exist, so
 * "Ana is cooking" resolves but "a man is cooking" is plain text. No model call.
 */
export function parseQuery(text: string, people: readonly Person[]): ParsedQuery {
  const query = text.trim();
  const named = people.filter((p) => p.name);
  const split = /^(.+?)\s+(?:is|are)\s+(.+)$/i.exec(query);
  const subject = split?.[1] ?? "";
  const what = split?.[2] ?? query;

  const who: string[] = [];
  const ids: string[] = [];
  const unresolved: string[] = [];
  if (split) {
    for (const part of subject.split(/\s+and\s+/i)) {
      const wanted = part.trim().toLowerCase();
      const hit = named.find((p) => {
        const full = p.name!.toLowerCase();
        return full === wanted || full.split(/\s+/)[0] === wanted;
      });
      if (hit) {
        who.push(hit.name!);
        ids.push(hit.id);
      } else if (/^[A-Z][\p{L}'-]+(\s+[A-Z][\p{L}'-]+)*$/u.test(part.trim())) {
        unresolved.push(part.trim());
      }
    }
  }

  if (!ids.length && !unresolved.length) return { who: [], person_ids: [], what: query, unresolved: [] };
  return { who, person_ids: ids, what, unresolved };
}
