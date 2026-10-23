import type { MetricRecord } from "../../types";
import { formatDate } from "../../lib/format";
import { Tag } from "../atoms/Tag";
import { useI18n } from "../../i18n";

export interface MetricCardProps {
  metric: MetricRecord;
  rank: number;
  /** Reports listed before the rest collapse into a link to the metric's page. */
  maxReports?: number;
}

/**
 * One BI metric and the reports that use it. No preview: the metric name
 * opens its page in the BI platform, and each report opens there too. The
 * links are plain links, not a stretched card link, so each one is its own
 * target. Like the Archive card, it leads with rank, source and type.
 */
export function MetricCard({ metric, rank, maxReports = 3 }: MetricCardProps) {
  const { t } = useI18n();
  const listed = metric.reports.slice(0, maxReports);
  const more = metric.report_count - listed.length;
  return (
    <article className="mm-card mm-archive mm-metric" aria-label={t("card.result", { rank })}>
      <div className="mm-body">
        <div className="mm-archive-head mm-mono">
          <span>{rank}</span><span className="mm-source-name">{t("card.biSource")}</span><span>{t("card.metric")}</span>
        </div>
        <a className="mm-name" href={metric.deep_link} target="_blank" rel="noopener noreferrer">{metric.name}</a>
        <div className="mm-mono">
          <Tag>{metric.metric_id}</Tag>
          {metric.domain && <Tag>{metric.domain}</Tag>}
        </div>
        {metric.definition && <div className="mm-text">{metric.definition}</div>}
        {metric.report_count === 0 ? (
          <div className="mm-text">{t("card.noReports")}</div>
        ) : (
          <>
            <div className="mm-metric-count">{metric.report_count === 1 ? t("card.usedInOne") : t("card.usedIn", { count: metric.report_count })}</div>
            <ul className="mm-reports">
              {listed.map((r) => (
                <li key={r.report_id}>
                  <a href={r.deep_link} target="_blank" rel="noopener noreferrer">{r.title}</a>
                  <span className="mm-mono mm-text">{r.folder ? `${r.folder} · ` : ""}{formatDate(r.updated_at)}</span>
                </li>
              ))}
            </ul>
            {more > 0 && (
              <a className="mm-mono" href={metric.deep_link} target="_blank" rel="noopener noreferrer">{t("card.moreReports", { count: more })}</a>
            )}
          </>
        )}
      </div>
    </article>
  );
}
