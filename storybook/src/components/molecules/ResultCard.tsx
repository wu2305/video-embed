import { useState } from "react";
import type { Hit, Person } from "../../types";
import { displayName, formatTime } from "../../lib/format";
import { Tag } from "../atoms/Tag";
import { useI18n, type MessageKey } from "../../i18n";

export interface ResultCardProps {
  hit: Hit;
  rank: number;
  people?: readonly Person[];
  selected?: boolean;
  onOpen?: (hit: Hit) => void;
  /** Name and tags only (plus the thumbnail of a media hit): for lists where rank and score mean nothing. */
  compact?: boolean;
  /** Badge a media card "NAS", for lists that mix in Archive records. Document and audio cards always name NAS. */
  showSource?: boolean;
}

const GLYPH: Record<string, string> = { video: "▶", image: "▣" };

/** Only video and image hits have a frame to show; documents and audio get none. */
function hasThumb(hit: Hit): boolean {
  return hit.kind === "video" || hit.kind === "image";
}

function thumbSrc(hit: Hit): string {
  return hit.thumb_url ?? `/api/thumb?id=${hit.unit_id}`;
}

/**
 * One NAS search hit. Same layout as the console card, plus scene range, notes and source.
 * The file name is the button; it stretches over the card, so the whole card is clickable.
 * A document or audio hit has no thumbnail frame: like an Archive record, it leads
 * with source and kind.
 */
export function ResultCard({ hit, rank, people = [], selected = false, onOpen, compact = false, showSource = false }: ResultCardProps) {
  const { t, s } = useI18n();
  const name = hit.path.split("/").pop() ?? hit.path;
  // The folder tells a file from its copy; `title` never shows on touch.
  const folder = hit.path.slice(0, hit.path.length - name.length);
  // A thumbnail that fails to load falls back to the kind glyph, not a broken image.
  const [thumbFailed, setThumbFailed] = useState(false);
  const thumb = hasThumb(hit);
  const src = thumbFailed ? null : thumbSrc(hit);
  const machineText = s((hit.ocr_text || hit.asr_text || "").trim());
  const hasRange = hit.scene_start != null && hit.scene_end != null;

  return (
    <article className={`mm-card${thumb ? "" : " mm-plain"}${selected ? " selected" : ""}`} aria-label={t("card.result", { rank })} data-unit-id={hit.unit_id}>
      {thumb && (
        <div className="mm-thumb">
          {src ? <img loading="lazy" src={src} alt="" onError={() => setThumbFailed(true)} /> : <span className="mm-glyph" aria-hidden>{GLYPH[hit.kind]}</span>}
          {showSource && <span className="mm-source">NAS</span>}
        </div>
      )}
      <div className="mm-body">
        {!thumb && (
          <div className="mm-plain-head mm-mono">
            <span className="mm-source-name">NAS</span><span>{t(`kind.${hit.kind}` as MessageKey)}</span>
          </div>
        )}
        <button type="button" className="mm-name mm-card-link" title={hit.path} onClick={() => onOpen?.(hit)}>{name}</button>
        {/* A long folder loses its start, so the folder nearest the file stays visible. */}
        {folder && <div className="mm-mono mm-path" title={hit.path}><bdi>{folder}</bdi></div>}
        {/* Scan order: the matched range first, then what the file is and who is in it. */}
        <div className="mm-mono">
          {hasRange && <Tag tone="good">{formatTime(hit.scene_start!)}–{formatTime(hit.scene_end!)}</Tag>}
          {thumb && <Tag>{t(`kind.${hit.kind}` as MessageKey)}</Tag>}
          {hit.face_count > 0 && <Tag>{hit.face_count > 1 ? t("card.faces", { count: hit.face_count }) : t("card.face", { count: hit.face_count })}</Tag>}
          {hit.person_ids.map((id) => {
            const label = displayName(id, people);
            return <Tag key={id} tone={label !== id ? "accent" : "neutral"}>{label}</Tag>;
          })}
          {!hit.is_master && <Tag tone="warn">{t("card.copy")}</Tag>}
        </div>
        {!compact && hit.notes?.map((note) => <div key={note} className="mm-text note">{s(note)}</div>)}
        {!compact && machineText && <div className="mm-text mm-transcript">{machineText.slice(0, 180)}</div>}
      </div>
    </article>
  );
}
