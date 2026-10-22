import { useEffect, useRef, type ReactNode } from "react";
import type { Annotation, Face, Hit, Person, Scene, Unavailable } from "../../types";
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
  /** Extra buttons placed before Copy path, such as "Open clip". */
  actions?: ReactNode;
  /**
   * Set when `/api/source` refuses the file although the snapshot lists it:
   * its permissions changed (`forbidden`) or it left the NAS (`gone`) since
   * last night's update. The preview fails closed and shows no frame.
   */
  unavailable?: Unavailable;
}

const UNAVAILABLE: Record<Unavailable, { title: string; body: string }> = {
  forbidden: {
    title: "You no longer have access to this file",
    body: "Its folder permissions changed after last night’s update. It drops out of your results after tonight’s update.",
  },
  gone: {
    title: "This file is no longer on the NAS",
    body: "It was deleted or moved after last night’s update. A moved file reappears under its new path tomorrow.",
  },
};

/**
 * Scene 5: the matched moment, not the file. Plays the scene range on a loop,
 * overlays face names and the note under the playhead, and steps through hits
 * with the arrow keys.
 */
export function PreviewPanel({
  hit, position, total, frameSrc, videoSrc, faces = [], people = [], annotations = [],
  scenes = [], duration = 0, playhead, onSeek, onPrev, onNext, onClose, actions, unavailable,
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
          {unavailable ? (
            <div className="mm-unavailable" role="alert">
              <strong>{UNAVAILABLE[unavailable].title}</strong>
              <span>{UNAVAILABLE[unavailable].body}</span>
            </div>
          ) : (
            <>
              {videoSrc ? <video ref={video} src={videoSrc} controls muted playsInline onTimeUpdate={loop} /> : <img src={frameSrc} alt={`Matched scene of ${name}`} />}
              <FaceOverlay faces={faces} people={people} />
              {activeNote && <div className="mm-overlay-note">{activeNote.text}</div>}
            </>
          )}
        </div>
        {!unavailable && hit.kind === "video" && duration > 0 && (
          <div style={{ marginTop: 10 }}>
            <AnnotationTrack duration={duration} scenes={scenes} annotations={annotations} playhead={now} matched={range} onSeek={onSeek} />
          </div>
        )}
      </div>
      <aside>
        <div className="mm-nav">
          <Button onClick={onPrev} disabled={position <= 1}>Previous <Kbd>←</Kbd></Button>
          <span className="mm-mono">{position} / {total}</span>
          <Button onClick={onNext} disabled={position >= total}>Next <Kbd>→</Kbd></Button>
        </div>
        <h2 title={hit.path}>{name}</h2>
        <div className="mm-mono">
          <Tag>{hit.kind}</Tag>
          {range && <Tag tone="good">{formatTime(range.start)}–{formatTime(range.end)}</Tag>}
          {!unavailable && hit.person_ids.map((id) => <Tag key={id} tone="accent">{displayName(id, people)}</Tag>)}
        </div>
        <div className="mm-mono">score {hit.score.toFixed(3)} = sim {hit.similarity.toFixed(3)} + text {hit.text_bonus.toFixed(2)}{hit.note_bonus ? ` + note ${hit.note_bonus.toFixed(2)}` : ""}</div>
        {!unavailable && text && <div className="mm-text">{text}</div>}
        {!unavailable && hit.notes?.map((n) => <div key={n} className="mm-text note">{n}</div>)}
        <div className="mm-row">
          {!unavailable && actions}
          <Button onClick={() => navigator.clipboard?.writeText(hit.path)}>Copy path</Button>
          <Button variant="ghost" onClick={onClose}>Close <Kbd>Esc</Kbd></Button>
        </div>
      </aside>
    </div>
  );
}
