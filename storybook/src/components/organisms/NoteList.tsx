import type { Annotation, Person } from "../../types";
import { NoteItem } from "../molecules/NoteItem";
import { useI18n } from "../../i18n";

export interface NoteListProps {
  notes: readonly Annotation[];
  people?: readonly Person[];
  playhead?: number;
  onSeek?: (seconds: number) => void;
}

/** Notes on one clip in time order. The note under the playhead is marked current. */
export function NoteList({ notes, people, playhead = -1, onSeek }: NoteListProps) {
  const { t } = useI18n();
  if (notes.length === 0) return <p className="mm-empty">{t("notes.none")}</p>;
  const sorted = [...notes].sort((a, b) => a.t_start - b.t_start);
  return (
    <ul className="mm-notes" aria-label={t("notes.label")}>
      {sorted.map((note) => (
        <li key={note.id}>
          <NoteItem note={note} people={people} onSeek={onSeek}
            current={playhead >= note.t_start && (note.t_end === null || playhead <= note.t_end)} />
        </li>
      ))}
    </ul>
  );
}
