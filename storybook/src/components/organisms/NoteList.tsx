import type { Annotation, Person } from "../../types";
import { NoteItem } from "../molecules/NoteItem";

export interface NoteListProps {
  notes: readonly Annotation[];
  people?: readonly Person[];
  playhead?: number;
  onSeek?: (seconds: number) => void;
}

/** Notes on one clip in time order. The note under the playhead is marked current. */
export function NoteList({ notes, people, playhead = -1, onSeek }: NoteListProps) {
  if (notes.length === 0) return <p className="mm-empty">No notes yet. Add one for the scene under the playhead.</p>;
  const sorted = [...notes].sort((a, b) => a.t_start - b.t_start);
  return (
    <ul className="mm-notes" aria-label="Notes">
      {sorted.map((note) => (
        <li key={note.id}>
          <NoteItem note={note} people={people} onSeek={onSeek}
            current={playhead >= note.t_start && (note.t_end === null || playhead <= note.t_end)} />
        </li>
      ))}
    </ul>
  );
}
