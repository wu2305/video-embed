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
 * It has no thumbnail frame: it leads with rank, source and record type.
 */
export function ArchiveCard({ record, rank }: ArchiveCardProps) {
  return (
    <article className="mm-card mm-archive" aria-label={`Result ${rank}`}>
      <div className="mm-body">
        <div className="mm-archive-head mm-mono">
          <span>{rank}</span><span className="mm-source-name">Archive</span><span>{record.doc_type}</span>
        </div>
        <a className="mm-name mm-card-link" href={record.deep_link} target="_blank" rel="noopener noreferrer" title={record.title}>
          {record.title}
        </a>
        <div className="mm-mono">
          <Tag>{formatDate(record.archived_at)}</Tag>
          {record.department && <Tag>{record.department}</Tag>}
        </div>
        {record.summary && <div className="mm-text">{record.summary}</div>}
        <div className="mm-mono">{record.record_id} · opens in the Archive System ↗</div>
      </div>
    </article>
  );
}
