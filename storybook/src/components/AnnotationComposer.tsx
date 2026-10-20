import { useId, useState } from "react";
import type { Annotation, Person, Scene } from "../types";
import { displayName, formatTime, parseTime } from "../lib/format";

export interface AnnotationComposerProps {
  /** Playhead position in seconds. */
  time: number;
  /** Scene under the playhead. Its range is the default for a new note. */
  scene?: Scene | null;
  /** People detected in the current frame, offered as chips. */
  inFrame?: readonly Person[];
  people?: readonly Person[];
  /** Still media have no time range. */
  still?: boolean;
  onSave?: (note: Omit<Annotation, "id" | "author">) => void;
}

/** Scene 2: attach a typed note to a time range, optionally tied to people in frame. */
export function AnnotationComposer({ time, scene = null, inFrame = [], people = [], still = false, onSave }: AnnotationComposerProps) {
  const start = scene?.start ?? time;
  const [text, setText] = useState("");
  const [from, setFrom] = useState(formatTime(start));
  const [to, setTo] = useState(scene ? formatTime(scene.end) : "");
  const [chosen, setChosen] = useState<string[]>([]);
  const textId = useId();
  const fromId = useId();
  const toId = useId();

  const t_start = parseTime(from);
  const t_end = to.trim() === "" ? null : parseTime(to);
  const rangeError = still ? null
    : t_start === null || (to.trim() !== "" && t_end === null) ? "Use mm:ss or seconds."
    : t_end !== null && t_end <= t_start ? "End must be after start."
    : null;
  const canSave = text.trim() !== "" && !rangeError;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSave) return;
    onSave?.({ t_start: still ? 0 : t_start!, t_end: still ? null : t_end, text: text.trim(), person_ids: chosen });
    setText("");
    setChosen([]);
  }

  return (
    <form className="mm-panel mm-note-form" onSubmit={submit} aria-label="Add note">
      <div className="mm-field">
        <label htmlFor={textId}>note</label>
        <textarea id={textId} value={text} onChange={(e) => setText(e.target.value)} placeholder="Ana is presenting the Q3 budget" />
      </div>
      {!still && (
        <div className="mm-row">
          <div className="mm-field">
            <label htmlFor={fromId}>from</label>
            <input id={fromId} type="text" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 90 }} aria-invalid={rangeError !== null} />
          </div>
          <div className="mm-field">
            <label htmlFor={toId}>to (blank = open-ended)</label>
            <input id={toId} type="text" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 90 }} aria-invalid={rangeError !== null} />
          </div>
        </div>
      )}
      {rangeError && <p className="mm-mono" role="alert"><span className="mm-tag bad">range</span>{rangeError}</p>}
      {inFrame.length > 0 && (
        <div className="mm-field">
          <span className="mm-label">people in frame</span>
          <div className="mm-chips">
            {inFrame.map((p) => (
              <button key={p.id} type="button" className="mm-chip" aria-pressed={chosen.includes(p.id)} onClick={() => setChosen((c) => (c.includes(p.id) ? c.filter((x) => x !== p.id) : [...c, p.id]))}>
                {displayName(p.id, people.length ? people : inFrame)}
              </button>
            ))}
          </div>
        </div>
      )}
      <div><button className="mm-primary" type="submit" disabled={!canSave}>Save note</button></div>
    </form>
  );
}
