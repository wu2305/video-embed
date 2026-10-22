import type { ArchiveRecord } from "../../types";
import { formatDate } from "../../lib/format";
import { Tag } from "../atoms/Tag";

export interface ArchiveCardProps {
  record: ArchiveRecord;
  rank: number;
}

/**
 * One Archive System record (scene 4c). Metadata only: there is no preview,
 * because the gateway never fetches the document. The title is a link that
 * opens the record in the Archive System, which checks access again itself.
 */
export function ArchiveCard({ record, rank }: ArchiveCardProps) {
  return (
    <article className="mm-card mm-archive" aria-label={`Result ${rank}`}>
      <div className="mm-thumb">
        <span className="mm-glyph" aria-hidden>▤</span>
        <span className="mm-rank">{rank}</span>
        <span className="mm-source">Archive</span>
      </div>
      <div className="mm-body">
        <a className="mm-name mm-card-link" href={record.deep_link} target="_blank" rel="noopener noreferrer" title={record.title}>
          {record.title}
        </a>
        <div className="mm-mono">
          <Tag>{record.doc_type}</Tag>
          <Tag>{formatDate(record.archived_at)}</Tag>
          {record.department && <Tag>{record.department}</Tag>}
        </div>
        {record.summary && <div className="mm-text">{record.summary}</div>}
        <div className="mm-mono">{record.record_id} · opens in the Archive System ↗</div>
      </div>
    </article>
  );
}
