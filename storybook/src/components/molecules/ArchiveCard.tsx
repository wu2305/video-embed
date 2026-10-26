import type { ArchiveRecord } from "../../types";
import { formatDate } from "../../lib/format";
import { Tag } from "../atoms/Tag";
import { useI18n } from "../../i18n";

export interface ArchiveCardProps {
  record: ArchiveRecord;
  rank: number;
}

/**
 * One Archive System record (scene 4c). Metadata only: there is no preview,
 * because the gateway never fetches the document. The title is a link that
 * opens the record in the Archive System, which checks access again itself.
 * It has no thumbnail frame: it leads with source and record type.
 */
export function ArchiveCard({ record, rank }: ArchiveCardProps) {
  const { t, s } = useI18n();
  return (
    <article className="mm-card mm-archive" aria-label={t("card.result", { rank })}>
      <div className="mm-body">
        <div className="mm-archive-head mm-mono">
          <span className="mm-source-name">{t("card.archiveSource")}</span><span>{s(record.doc_type)}</span>
        </div>
        <a className="mm-name mm-card-link" href={record.deep_link} target="_blank" rel="noopener noreferrer" title={s(record.title)}>
          {s(record.title)}
        </a>
        <div className="mm-mono">
          <Tag>{formatDate(record.archived_at)}</Tag>
          {record.department && <Tag>{s(record.department)}</Tag>}
        </div>
        {record.summary && <div className="mm-text">{s(record.summary)}</div>}
      </div>
    </article>
  );
}
