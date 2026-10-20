import type { Person } from "../../types";
import { Tag } from "../atoms/Tag";

export interface PersonCardProps {
  person: Person;
  /** A face crop from the cluster. Falls back to a glyph. */
  sampleSrc?: string;
  selected?: boolean;
  onOpen?: (person: Person) => void;
}

/** One person cluster: face sample, name (or cluster id when unnamed) and appearance count. */
export function PersonCard({ person, sampleSrc, selected = false, onOpen }: PersonCardProps) {
  const label = person.name ?? person.id;
  return (
    <article className={`mm-card mm-person${person.name ? "" : " unnamed"}${selected ? " selected" : ""}`}>
      <div className="mm-thumb">
        {sampleSrc ? <img loading="lazy" src={sampleSrc} alt="" /> : <span className="mm-glyph" aria-hidden>☺</span>}
        <span className="mm-score" aria-label={`${person.faces} appearances`}>{person.faces}</span>
      </div>
      <div className="mm-body">
        <button type="button" className="mm-name mm-card-link" title={label} aria-pressed={selected} onClick={() => onOpen?.(person)}>{label}</button>
        <div className="mm-mono">
          {person.name ? <Tag tone="accent">named</Tag> : <Tag tone="warn">unnamed</Tag>}
          {person.name && <Tag>{person.id}</Tag>}
        </div>
      </div>
    </article>
  );
}
