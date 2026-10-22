import type { Hit, Person } from "../../types";
import { displayName, formatTime } from "../../lib/format";
import { Tag } from "../atoms/Tag";

export interface ResultCardProps {
  hit: Hit;
  rank: number;
  people?: readonly Person[];
  selected?: boolean;
  onOpen?: (hit: Hit) => void;
  /** Thumbnail, name and tags only: for lists where rank and score mean nothing. */
  compact?: boolean;
  /** Badge the card "NAS", for lists that mix in Archive records. */
  showSource?: boolean;
}

const GLYPH: Record<string, string> = { audio: "♪", document: "▤", video: "▶", image: "▣" };

function thumbSrc(hit: Hit): string | null {
  if (hit.thumb_url) return hit.thumb_url;
  if (hit.kind === "video" || hit.kind === "image") return `/api/thumb?id=${hit.unit_id}`;
  return null;
}

/**
 * One NAS search hit. Same layout as the console card, plus scene range, notes and source.
 * The file name is the button; it stretches over the card, so the whole card is clickable.
 */
export function ResultCard({ hit, rank, people = [], selected = false, onOpen, compact = false, showSource = false }: ResultCardProps) {
  const name = hit.path.split("/").pop() ?? hit.path;
  // The folder tells a file from its copy; `title` never shows on touch.
  const folder = hit.path.slice(0, hit.path.length - name.length);
  const src = thumbSrc(hit);
  const machineText = (hit.ocr_text || hit.asr_text || "").trim();
  const bonus = hit.text_bonus ? ` +${hit.text_bonus.toFixed(2)} text` : "";
  const hasRange = hit.scene_start != null && hit.scene_end != null;

  return (
    <article className={`mm-card${selected ? " selected" : ""}`} aria-label={`Result ${rank}`} data-unit-id={hit.unit_id}>
      <div className="mm-thumb">
        {src ? <img loading="lazy" src={src} alt="" /> : <span className="mm-glyph" aria-hidden>{GLYPH[hit.kind]}</span>}
        {!compact && <span className="mm-rank">{rank}</span>}
        {showSource && <span className="mm-source">NAS</span>}
        {!compact && <span className="mm-score">{hit.score.toFixed(3)}{bonus}</span>}
      </div>
      <div className="mm-body">
        <button type="button" className="mm-name mm-card-link" title={hit.path} onClick={() => onOpen?.(hit)}>{name}</button>
        {folder && <div className="mm-mono mm-path" title={hit.path}>{folder}</div>}
        {!compact && <div className="mm-mono">sim {hit.similarity.toFixed(3)} · unit {hit.unit_index}</div>}
        <div className="mm-mono">
          <Tag>{hit.kind}</Tag>
          {hasRange && <Tag tone="good">{formatTime(hit.scene_start!)}–{formatTime(hit.scene_end!)}</Tag>}
          {hit.face_count > 0 && <Tag>{hit.face_count} face{hit.face_count > 1 ? "s" : ""}</Tag>}
          {hit.person_ids.map((id) => {
            const label = displayName(id, people);
            return <Tag key={id} tone={label !== id ? "accent" : "neutral"}>{label}</Tag>;
          })}
          {!hit.is_master && <Tag tone="warn">copy</Tag>}
        </div>
        {!compact && hit.notes?.map((note) => <div key={note} className="mm-text note">{note}</div>)}
        {!compact && machineText && <div className="mm-text">{machineText.slice(0, 180)}</div>}
      </div>
    </article>
  );
}
