import type { Annotation, Person } from "../../types";
import { displayName, formatTime } from "../../lib/format";
import { Tag } from "../atoms/Tag";

export interface NoteItemProps {
  note: Annotation;
  people?: readonly Person[];
  /** True when the playhead is inside the note's range. */
  current?: boolean;
  onSeek?: (seconds: number) => void;
}

/** One user note: its time range, text, people and author. Clicking seeks to its start. */
export function NoteItem({ note, people = [], current = false, onSeek }: NoteItemProps) {
  const range = note.t_end === null ? `${formatTime(note.t_start)}–` : `${formatTime(note.t_start)}–${formatTime(note.t_end)}`;
  return (
    <div className="mm-note" aria-current={current}>
      <Tag tone={current ? "accent" : "good"}>{range}</Tag>
      <button type="button" className="mm-note-text mm-card-link" aria-current={current} onClick={() => onSeek?.(note.t_start)}>{note.text}</button>
      <span className="mm-note-meta mm-mono">
        {note.person_ids.map((id) => <Tag key={id} tone="accent">{displayName(id, people)}</Tag>)}
        {note.author}
      </span>
    </div>
  );
}
