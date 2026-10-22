import { useState } from "react";
import type { Annotation, Face, Hit, IndexInfo, Person, Scene, Viewer } from "../types";
import { displayName, formatTime } from "../lib/format";
import { Panel } from "../components/atoms/Panel";
import { Tag } from "../components/atoms/Tag";
import { MetaList } from "../components/molecules/MetaList";
import { AnnotationComposer } from "../components/organisms/AnnotationComposer";
import { AnnotationTrack } from "../components/organisms/AnnotationTrack";
import { FaceOverlay } from "../components/organisms/FaceOverlay";
import { NoteList } from "../components/organisms/NoteList";
import type { PageId } from "../components/organisms/TopBar";
import { AppShell } from "../components/templates/AppShell";

export interface ClipPageProps {
  hit: Hit;
  frameSrc: string;
  faces?: readonly Face[];
  people?: readonly Person[];
  scenes?: readonly Scene[];
  duration?: number;
  annotations?: readonly Annotation[];
  /** Start here instead of the matched scene. */
  initialPlayhead?: number;
  index?: IndexInfo;
  now?: number;
  viewer?: Viewer;
  onNavigate?: (page: PageId) => void;
  onBack?: () => void;
}

/** Page: one file. Watch the matched scene, see who is in frame, read and write notes on the timeline. */
export function ClipPage({
  hit, frameSrc, faces = [], people = [], scenes = [], duration = 0, annotations = [], initialPlayhead,
  index, now, viewer, onNavigate, onBack,
}: ClipPageProps) {
  const still = hit.kind !== "video" && hit.kind !== "audio";
  const hasFrame = hit.kind === "video" || hit.kind === "image";
  const matched: Scene | null = hit.scene_start != null && hit.scene_end != null ? { start: hit.scene_start, end: hit.scene_end } : null;
  const [playhead, setPlayhead] = useState(initialPlayhead ?? matched?.start ?? 0);
  const [notes, setNotes] = useState<Annotation[]>(() => [...annotations]);
  const scene = scenes.find((s) => playhead >= s.start && playhead < s.end) ?? null;
  const name = hit.path.split("/").pop() ?? hit.path;
  const activeNote = notes.find((a) => playhead >= a.t_start && (a.t_end === null || playhead <= a.t_end));
  const inFrame = people.filter((p) => faces.some((f) => f.person_id === p.id));

  return (
    <AppShell current="clip" title={name} index={index} now={now} viewer={viewer} onNavigate={onNavigate}
      crumbs={<><a href="#search" onClick={(e) => { e.preventDefault(); onBack?.(); }}>← Search results</a> / {hit.kind}</>}
      subtitle={<span className="mm-mono">{hit.path}</span>}>
      <div className="mm-split">
        <div style={{ display: "grid", gap: 14 }}>
          <div className="mm-stage">
            {hasFrame ? (
              <img src={frameSrc} alt={`${name} at ${formatTime(playhead)}`} />
            ) : (
              <div className="mm-thumb" style={{ aspectRatio: "16 / 6" }}><span className="mm-glyph" aria-hidden>{hit.kind === "audio" ? "♪" : "▤"}</span></div>
            )}
            {hasFrame && <FaceOverlay faces={faces} people={people} />}
            {!still && activeNote && <div className="mm-overlay-note">{activeNote.text}</div>}
          </div>
          {!still && duration > 0 && (
            <AnnotationTrack duration={duration} scenes={scenes} annotations={notes} playhead={playhead} matched={matched} onSeek={setPlayhead} />
          )}
          <div className="mm-mono">
            {matched && <Tag tone="good">matched {formatTime(matched.start)}–{formatTime(matched.end)}</Tag>}
            {hit.person_ids.map((id) => <Tag key={id} tone={displayName(id, people) !== id ? "accent" : "neutral"}>{displayName(id, people)}</Tag>)}
            {!hit.is_master && <Tag tone="warn">copy</Tag>}
          </div>
          {(hit.ocr_text || hit.asr_text) && (
            <Panel as="section" title={hit.asr_text ? "Speech" : "On-screen text"}>
              <p className="mm-transcript" style={{ margin: 0 }}>{(hit.asr_text || hit.ocr_text).trim()}</p>
            </Panel>
          )}
        </div>
        <aside>
          <Panel as="section" title="Details">
            <MetaList items={[
              ["kind", <Tag>{hit.kind}</Tag>],
              ...(duration && !still ? [["duration", formatTime(duration)] as const, ["scenes", String(scenes.length)] as const] : []),
              ["unit", `${hit.unit_index} (id ${hit.unit_id})`],
              ["faces in frame", String(hasFrame && faces.length ? faces.length : hit.face_count)],
              ["source", "NAS media library"],
            ]} />
          </Panel>
          <Panel as="section" title={`Notes (${notes.length})`}>
            <NoteList notes={notes} people={people} playhead={still ? -1 : playhead} onSeek={setPlayhead} />
            <p className="mm-hint" style={{ margin: "10px 0 0" }}>Notes are visible to everyone who can open this file, with the author’s name.</p>
          </Panel>
          <AnnotationComposer key={still ? "still" : scene?.start ?? "none"} time={playhead} scene={scene} still={still}
            inFrame={inFrame} people={people}
            onSave={(n) => setNotes((cur) => [...cur, { ...n, id: `n${cur.length + 1}`, author: viewer?.name ?? "you" }])} />
        </aside>
      </div>
    </AppShell>
  );
}
