import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Annotation, Face, Hit, Person, Scene, Unavailable } from "../../types";
import { displayName, formatTime } from "../../lib/format";
import { Button } from "../atoms/Button";
import { Kbd } from "../atoms/Kbd";
import { Tag } from "../atoms/Tag";
import { AnnotationTrack } from "./AnnotationTrack";
import { FaceOverlay } from "./FaceOverlay";
import { useI18n, type MessageKey } from "../../i18n";

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
  /**
   * Shown over the page as a modal dialog: takes focus when it opens and keeps
   * Tab inside itself. The caller makes the page behind it inert.
   */
  modal?: boolean;
}

const FOCUSABLE = "a[href], button:not(:disabled), input, select, textarea, video[controls], [tabindex]:not([tabindex='-1'])";

const UNAVAILABLE: Record<Unavailable, MessageKey> = { forbidden: "preview.forbidden", gone: "preview.gone" };

/**
 * Scene 5: the matched moment, not the file. Plays the scene range on a loop,
 * overlays face names and the note under the playhead, and steps through hits
 * with the arrow keys.
 */
export function PreviewPanel({
  hit, position, total, frameSrc, videoSrc, faces = [], people = [], annotations = [],
  scenes = [], duration = 0, playhead, onSeek, onPrev, onNext, onClose, actions, unavailable, modal = false,
}: PreviewPanelProps) {
  const { t } = useI18n();
  const video = useRef<HTMLVideoElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const range: Scene | null = hit.scene_start != null && hit.scene_end != null ? { start: hit.scene_start, end: hit.scene_end } : null;
  const now = playhead ?? range?.start ?? 0;
  const activeNote = annotations.find((a) => now >= a.t_start && (a.t_end === null || now <= a.t_end));

  // Seek to the matched scene when the hit changes.
  useEffect(() => {
    if (video.current && range) video.current.currentTime = range.start;
  }, [hit.unit_id, range?.start]);

  // A modal takes focus when it opens, so Escape and the arrow keys work at once.
  useEffect(() => {
    if (modal) dialog.current?.focus({ preventScroll: true });
  }, [modal]);

  function loop() {
    if (video.current && range && video.current.currentTime >= range.end) video.current.currentTime = range.start;
  }

  function keys(event: React.KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose?.();
      return;
    }
    if (event.key === "Tab" && modal) {
      trap(event);
      return;
    }
    if ((event.target as HTMLElement).closest("input, textarea, [role=slider]")) return;
    if (event.key === "ArrowLeft") onPrev?.();
    else if (event.key === "ArrowRight") onNext?.();
    else return;
    event.preventDefault();
  }

  // Tab from the last control wraps to the first, and Shift+Tab the other way.
  function trap(event: React.KeyboardEvent) {
    const items = [...(dialog.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
    const first = items[0], last = items[items.length - 1];
    if (!first || !last) { event.preventDefault(); return; }
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === dialog.current)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
  }

  const name = hit.path.split("/").pop() ?? hit.path;
  const text = (hit.ocr_text || hit.asr_text).trim();

  return (
    <div ref={dialog} className="mm-preview" role="dialog" aria-modal={modal || undefined} aria-label={t("preview.label", { name })} tabIndex={-1} onKeyDown={keys}>
      <div>
        <div className="mm-stage">
          {unavailable ? (
            <div className="mm-unavailable" role="alert">
              <strong>{t(UNAVAILABLE[unavailable])}</strong>
            </div>
          ) : (
            <>
              {videoSrc ? <video ref={video} src={videoSrc} controls muted playsInline onTimeUpdate={loop} /> : <img src={frameSrc} alt={t("preview.matched", { name })} />}
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
          <Button onClick={onPrev} disabled={position <= 1}>{t("preview.previous")} <Kbd>←</Kbd></Button>
          <span className="mm-mono">{position} / {total}</span>
          <Button onClick={onNext} disabled={position >= total}>{t("preview.next")} <Kbd>→</Kbd></Button>
        </div>
        <h2 title={hit.path}>{name}</h2>
        <div className="mm-mono">
          <Tag>{hit.kind}</Tag>
          {range && <Tag tone="good">{formatTime(range.start)}–{formatTime(range.end)}</Tag>}
          {!unavailable && hit.person_ids.map((id) => <Tag key={id} tone="accent">{displayName(id, people)}</Tag>)}
        </div>
        {!unavailable && text && <div className="mm-text mm-transcript">{text}</div>}
        {!unavailable && hit.notes?.map((n) => <div key={n} className="mm-text note">{n}</div>)}
        <div className="mm-row">
          {!unavailable && actions}
          <CopyPath key={hit.path} path={hit.path} />
          <Button variant="ghost" onClick={onClose}>{t("preview.close")} <Kbd>Esc</Kbd></Button>
        </div>
      </aside>
    </div>
  );
}

/**
 * Copy path never fails silently: "Path copied" for two seconds, or, when the
 * clipboard is refused (permissions, an insecure page), the path in a field,
 * selected, ready for Ctrl+C.
 */
function CopyPath({ path }: { path: string }) {
  const { t } = useI18n();
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (state === "copied") {
      const timer = setTimeout(() => setState("idle"), 2000);
      return () => clearTimeout(timer);
    }
    if (state === "failed") field.current?.select();
  }, [state]);

  async function copy() {
    try {
      if (!navigator.clipboard) throw new Error("no clipboard");
      await navigator.clipboard.writeText(path);
      setState("copied");
    } catch {
      setState("failed");
    }
  }

  return (
    <>
      <Button onClick={copy}>{t("preview.copyPath")}</Button>
      <span className="mm-hint" role="status">{state === "copied" ? t("preview.copied") : state === "failed" ? t("preview.copyFailed") : ""}</span>
      {state === "failed" && <input ref={field} type="text" readOnly value={path} aria-label={t("preview.pathField")} className="mm-mono" style={{ flexBasis: "100%" }} />}
    </>
  );
}
