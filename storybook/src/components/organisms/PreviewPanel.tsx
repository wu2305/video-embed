import { useEffect, useRef } from "react";
import type { Annotation, Face, Hit, Person, Scene } from "../../types";
import { displayName, formatTime } from "../../lib/format";
import { Button } from "../atoms/Button";
import { Kbd } from "../atoms/Kbd";
import { Tag } from "../atoms/Tag";
import { AnnotationTrack } from "./AnnotationTrack";
import { FaceOverlay } from "./FaceOverlay";

export interface PreviewPanelProps {
  hit: Hit;
  /** Position within the result list, for the "3 / 12" counter. */
  position: number;
  total: number;
  /** Poster frame. Used when no `videoSrc` is given, as in these stories. */
  frameSrc: string;
  videoSrc?: string;
  faces?: readonly Face[];
  people?: readonly Person[];
  annotations?: readonly Annotation[];
  scenes?: readonly Scene[];
  duration?: number;
  playhead?: number;
  onSeek?: (seconds: number) => void;
  onPrev?: () => void;
  onNext?: () => void;
  onClose?: () => void;
}

/**
 * Scene 5: the matched moment, not the file. Plays the scene range on a loop,
 * overlays face names and the note under the playhead, and steps through hits
 * with the arrow keys.
 */
export function PreviewPanel({
  hit, position, total, frameSrc, videoSrc, faces = [], people = [], annotations = [],
  scenes = [], duration = 0, playhead, onSeek, onPrev, onNext, onClose,
}: PreviewPanelProps) {
  const video = useRef<HTMLVideoElement>(null);
  const range: Scene | null = hit.scene_start != null && hit.scene_end != null ? { start: hit.scene_start, end: hit.scene_end } : null;
  const now = playhead ?? range?.start ?? 0;
  const activeNote = annotations.find((a) => now >= a.t_start && (a.t_end === null || now <= a.t_end));

  // Seek to the matched scene when the hit changes.
  useEffect(() => {
    if (video.current && range) video.current.currentTime = range.start;
  }, [hit.unit_id, range?.start]);

  function loop() {
    if (video.current && range && video.current.currentTime >= range.end) video.current.currentTime = range.start;
  }

  function keys(event: React.KeyboardEvent) {
    if ((event.target as HTMLElement).closest("input, textarea, [role=slider]")) return;
    if (event.key === "ArrowLeft") onPrev?.();
    else if (event.key === "ArrowRight") onNext?.();
    else if (event.key === "Escape") onClose?.();
    else return;
    event.preventDefault();
  }

  const name = hit.path.split("/").pop() ?? hit.path;
  const text = (hit.ocr_text || hit.asr_text).trim();

  return (
    <div className="mm-preview" role="dialog" aria-label={`Preview ${name}`} tabIndex={-1} onKeyDown={keys}>
      <div>
        <div className="mm-stage">
          {videoSrc ? <video ref={video} src={videoSrc} controls muted playsInline onTimeUpdate={loop} /> : <img src={frameSrc} alt={`Matched scene of ${name}`} />}
          <FaceOverlay faces={faces} people={people} />
          {activeNote && <div className="mm-overlay-note">{activeNote.text}</div>}
        </div>
        {hit.kind === "video" && duration > 0 && (
          <div style={{ marginTop: 10 }}>
            <AnnotationTrack duration={duration} scenes={scenes} annotations={annotations} playhead={now} matched={range} onSeek={onSeek} />
          </div>
        )}
      </div>
      <aside>
        <div className="mm-nav">
          <Button onClick={onPrev} disabled={position <= 1} aria-label="Previous result">Prev <Kbd>←</Kbd></Button>
          <span className="mm-mono">{position} / {total}</span>
          <Button onClick={onNext} disabled={position >= total} aria-label="Next result">Next <Kbd>→</Kbd></Button>
        </div>
        <h3 title={hit.path}>{name}</h3>
        <div className="mm-mono">
          <Tag>{hit.kind}</Tag>
          {range && <Tag tone="good">{formatTime(range.start)}–{formatTime(range.end)}</Tag>}
          {hit.person_ids.map((id) => <Tag key={id} tone="accent">{displayName(id, people)}</Tag>)}
        </div>
        <div className="mm-mono">score {hit.score.toFixed(3)} = sim {hit.similarity.toFixed(3)} + text {hit.text_bonus.toFixed(2)}{hit.note_bonus ? ` + note ${hit.note_bonus.toFixed(2)}` : ""}</div>
        {text && <div className="mm-text">{text}</div>}
        {hit.notes?.map((n) => <div key={n} className="mm-text note">{n}</div>)}
        <div className="mm-row">
          <Button onClick={() => navigator.clipboard?.writeText(hit.path)}>Copy path</Button>
          <Button variant="ghost" onClick={onClose}>Close <Kbd>Esc</Kbd></Button>
        </div>
      </aside>
    </div>
  );
}
