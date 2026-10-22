import type { Annotation, Scene } from "../../types";
import { formatTime } from "../../lib/format";
import { useI18n } from "../../i18n";

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

/** Timeline of scene cuts, notes and the matched range. Clicking seeks. On touch the hit band is 44px tall around the 28px track. */
export function AnnotationTrack({ duration, scenes, annotations = [], playhead = 0, matched = null, onSeek }: AnnotationTrackProps) {
  const { t } = useI18n();
  function seek(event: React.MouseEvent<HTMLDivElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    onSeek?.(Math.round(((event.clientX - box.left) / box.width) * duration));
  }

  return (
    <div>
      <div
        className="mm-scrub"
        role="slider"
        tabIndex={0}
        aria-label={t("timeline.label")}
        aria-valuemin={0}
        aria-valuemax={duration}
        aria-valuenow={Math.round(playhead)}
        aria-valuetext={formatTime(playhead)}
        onClick={seek}
        aria-orientation="horizontal"
        onKeyDown={(e) => {
          // Arrows step 5s, Page Up/Down 30s, Home/End jump to either end.
          const to = { ArrowRight: playhead + 5, ArrowLeft: playhead - 5, PageUp: playhead + 30, PageDown: playhead - 30, Home: 0, End: duration }[e.key];
          if (to === undefined) return;
          e.preventDefault();
          onSeek?.(Math.min(duration, Math.max(0, to)));
        }}
      >
        <div className="mm-track">
          {scenes.map((s) => (
            <div key={s.start} className="scene" style={{ left: pct(s.start, duration), width: pct(s.end - s.start, duration) }} />
          ))}
          {matched && <div className="matched" style={{ left: pct(matched.start, duration), width: pct(matched.end - matched.start, duration) }} />}
          {annotations.map((a) => (
            <div key={a.id} className="note" title={a.text} style={{ left: pct(a.t_start, duration), width: pct((a.t_end ?? a.t_start + 2) - a.t_start, duration) }} />
          ))}
          <div className="playhead" style={{ left: pct(playhead, duration) }} />
        </div>
      </div>
      <div className="mm-track-legend mm-mono">
        <span>{formatTime(0)}</span>
        <span>{formatTime(playhead)} · {scenes.length} scenes · {annotations.length} notes</span>
        <span>{formatTime(duration)}</span>
      </div>
    </div>
  );
}
