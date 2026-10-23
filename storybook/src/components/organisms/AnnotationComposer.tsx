import { useId, useRef, useState } from "react";
import type { Annotation, Person, Scene } from "../../types";
import { displayName, formatTime, parseTime } from "../../lib/format";
import { Button } from "../atoms/Button";
import { Chip } from "../atoms/Chip";
import { Label } from "../atoms/Label";
import { Tag } from "../atoms/Tag";
import { Field } from "../molecules/Field";
import { useI18n } from "../../i18n";
import { useSubmitReason } from "../../lib/useSubmitReason";

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
  /** Pre-typed values, as after the user has started editing. */
  initialText?: string;
  initialTo?: string;
  onSave?: (note: Omit<Annotation, "id" | "author">) => void;
}

/** Scene 2: attach a typed note to a time range, optionally tied to people in frame. */
export function AnnotationComposer({ time, scene = null, inFrame = [], people = [], still = false, initialText = "", initialTo, onSave }: AnnotationComposerProps) {
  const { t } = useI18n();
  const start = scene?.start ?? time;
  const [text, setText] = useState(initialText);
  const [from, setFrom] = useState(formatTime(start));
  const [to, setTo] = useState(initialTo ?? (scene ? formatTime(scene.end) : ""));
  const [chosen, setChosen] = useState<string[]>([]);
  const textId = useId();
  const fromId = useId();
  const toId = useId();
  const textRef = useRef<HTMLTextAreaElement>(null);
  const fromRef = useRef<HTMLInputElement>(null);

  const t_start = parseTime(from);
  const t_end = to.trim() === "" ? null : parseTime(to);
  const rangeError = still ? null
    : t_start === null || (to.trim() !== "" && t_end === null) ? t("note.reason.format")
    : t_end !== null && t_end <= t_start ? t("note.reason.order")
    : null;
  // Save stays focusable; pressing it while blocked says why and focuses the field to fix.
  const reason = text.trim() === "" ? t("note.reason.empty") : rangeError;
  const { blocked, buttonProps, why } = useSubmitReason(reason, () => (text.trim() === "" ? textRef.current : fromRef.current));

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (blocked()) return;
    onSave?.({ t_start: still ? 0 : t_start!, t_end: still ? null : t_end, text: text.trim(), person_ids: chosen });
    setText("");
    setChosen([]);
  }

  return (
    <form className="mm-panel mm-note-form" onSubmit={submit} aria-label={t("note.form")}>
      <Field label={t("note.field")}>
        <textarea id={textId} ref={textRef} value={text} onChange={(e) => setText(e.target.value)} placeholder={t("note.placeholder")} />
      </Field>
      {!still && (
        <div className="mm-row">
          <Field label={t("note.from")}>
            <input id={fromId} ref={fromRef} type="text" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 90 }} aria-invalid={rangeError !== null} />
          </Field>
          <Field label={t("note.to")}>
            <input id={toId} type="text" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 90 }} aria-invalid={rangeError !== null} />
          </Field>
        </div>
      )}
      {rangeError && <p className="mm-hint" role="alert"><Tag tone="bad">{t("note.range")}</Tag>{rangeError}</p>}
      {inFrame.length > 0 && (
        <div className="mm-field">
          <Label as="span">{t("note.peopleInFrame")}</Label>
          <div className="mm-chips">
            {inFrame.map((p) => (
              <Chip key={p.id} pressed={chosen.includes(p.id)} onClick={() => setChosen((c) => (c.includes(p.id) ? c.filter((x) => x !== p.id) : [...c, p.id]))}>
                {displayName(p.id, people.length ? people : inFrame)}
              </Chip>
            ))}
          </div>
        </div>
      )}
      <div><Button variant="primary" type="submit" {...buttonProps}>{t("note.save")}</Button></div>
      {why}
    </form>
  );
}
