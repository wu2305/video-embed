import type { MetricRecord } from "../../types";
import { formatDate } from "../../lib/format";
import { Tag } from "../atoms/Tag";
import { useI18n } from "../../i18n";

export interface MetricCardProps {
  metric: MetricRecord;
  rank: number;
  /** Reports listed before the rest collapse into "+N more". */
  maxReports?: number;
  selected?: boolean;
  /** Opens the metric preview with every report. */
  onOpen?: (metric: MetricRecord) => void;
}

/**
 * One BI metric and its top reports (scene 4f). The metric name is the
 * button that opens the preview; it stretches over the card, and the report
 * links sit above it, so each report still opens straight in the BI platform.
 * Like the Archive card, it leads with source and type.
 */
export function MetricCard({ metric, rank, maxReports = 3, selected = false, onOpen }: MetricCardProps) {
  const { t } = useI18n();
  const listed = metric.reports.slice(0, maxReports);
  const more = metric.report_count - listed.length;
  return (
    <article className={`mm-card mm-archive mm-metric${selected ? " selected" : ""}`} aria-label={t("card.result", { rank })} data-metric-id={metric.metric_id}>
      <div className="mm-body">
        <div className="mm-archive-head mm-mono">
          <span className="mm-source-name">{t("card.biSource")}</span><span>{t("card.metric")}</span>
        </div>
        <button type="button" className="mm-name mm-card-link" onClick={() => onOpen?.(metric)}>{metric.name}</button>
        <div className="mm-mono">
          <Tag>{metric.metric_id}</Tag>
          {metric.domain && <Tag>{metric.domain}</Tag>}
        </div>
        {metric.definition && <div className="mm-text">{metric.definition}</div>}
        {metric.report_count === 0 ? (
          <div className="mm-text">{t("card.noReports")}</div>
        ) : (
          <>
            <ul className="mm-reports">
              {listed.map((r) => (
                <li key={r.report_id}>
                  <a href={r.deep_link} target="_blank" rel="noopener noreferrer">{r.title}</a>
                  <span className="mm-mono mm-text">{r.folder ? `${r.folder} · ` : ""}{formatDate(r.updated_at)}</span>
                </li>
              ))}
            </ul>
            {more > 0 && <div className="mm-text">{t("card.moreReports", { count: more })}</div>}
          </>
        )}
      </div>
    </article>
  );
}
