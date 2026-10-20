import type { Hit, Person } from "../../types";
import { displayName, formatTime } from "../../lib/format";
import { Tag } from "../atoms/Tag";

export interface ResultCardProps {
  hit: Hit;
  rank: number;
  people?: readonly Person[];
  selected?: boolean;
  onOpen?: (hit: Hit) => void;
}

const GLYPH: Record<string, string> = { audio: "♪", document: "▤", video: "▶", image: "▣" };

function thumbSrc(hit: Hit): string | null {
  if (hit.thumb_url) return hit.thumb_url;
  if (hit.kind === "video" || hit.kind === "image") return `/api/thumb?id=${hit.unit_id}`;
  return null;
}

/** One search hit. Same layout as the console card, plus scene range, notes and source. */
export function ResultCard({ hit, rank, people = [], selected = false, onOpen }: ResultCardProps) {
  const name = hit.path.split("/").pop() ?? hit.path;
  const src = thumbSrc(hit);
  const machineText = (hit.ocr_text || hit.asr_text || "").trim();
  const bonus = hit.text_bonus ? ` +${hit.text_bonus.toFixed(2)} text` : "";
  const hasRange = hit.scene_start != null && hit.scene_end != null;

  return (
    <button
      type="button"
      className={`mm-card${selected ? " selected" : ""}`}
      aria-label={`Open result ${rank}: ${name}`}
      aria-pressed={selected}
      onClick={() => onOpen?.(hit)}
    >
      <div className="mm-thumb">
        {src ? <img loading="lazy" src={src} alt="" /> : <span className="mm-glyph" aria-hidden>{GLYPH[hit.kind]}</span>}
        <span className="mm-rank">{rank}</span>
        {hit.source && <span className="mm-source">{hit.source}</span>}
        <span className="mm-score">{hit.score.toFixed(3)}{bonus}</span>
      </div>
      <div className="mm-body">
        <div className="mm-name" title={hit.path}>{name}</div>
        <div className="mm-mono">sim {hit.similarity.toFixed(3)} · unit {hit.unit_index}</div>
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
        {hit.notes?.map((note) => <div key={note} className="mm-text note">{note}</div>)}
        {machineText && <div className="mm-text">{machineText.slice(0, 180)}</div>}
      </div>
    </button>
  );
}
