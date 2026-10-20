import type { Annotation, Scene } from "../types";
import { formatTime } from "../lib/format";

export interface AnnotationTrackProps {
  duration: number;
  scenes: readonly Scene[];
  annotations?: readonly Annotation[];
  playhead?: number;
  /** The scene the search matched, shown in green. */
  matched?: Scene | null;
  onSeek?: (seconds: number) => void;
}

const pct = (value: number, total: number) => `${(Math.min(Math.max(value, 0), total) / total) * 100}%`;

/** Timeline of scene cuts, notes and the matched range. Clicking seeks. */
export function AnnotationTrack({ duration, scenes, annotations = [], playhead = 0, matched = null, onSeek }: AnnotationTrackProps) {
  function seek(event: React.MouseEvent<HTMLDivElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    onSeek?.(Math.round(((event.clientX - box.left) / box.width) * duration));
  }

  return (
    <div>
      <div
        className="mm-track"
        role="slider"
        tabIndex={0}
        aria-label="Timeline"
        aria-valuemin={0}
        aria-valuemax={duration}
        aria-valuenow={Math.round(playhead)}
        aria-valuetext={formatTime(playhead)}
        onClick={seek}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") onSeek?.(Math.min(duration, playhead + 5));
          if (e.key === "ArrowLeft") onSeek?.(Math.max(0, playhead - 5));
        }}
      >
        {scenes.map((s) => (
          <div key={s.start} className="scene" style={{ left: pct(s.start, duration), width: pct(s.end - s.start, duration) }} />
        ))}
        {matched && <div className="matched" style={{ left: pct(matched.start, duration), width: pct(matched.end - matched.start, duration) }} />}
        {annotations.map((a) => (
          <div key={a.id} className="note" title={a.text} style={{ left: pct(a.t_start, duration), width: pct((a.t_end ?? a.t_start + 2) - a.t_start, duration) }} />
        ))}
        <div className="playhead" style={{ left: pct(playhead, duration) }} />
      </div>
      <div className="mm-track-legend mm-mono">
        <span>{formatTime(0)}</span>
        <span>{formatTime(playhead)} · {scenes.length} scenes · {annotations.length} notes</span>
        <span>{formatTime(duration)}</span>
      </div>
    </div>
  );
}
