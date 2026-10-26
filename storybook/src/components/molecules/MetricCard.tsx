import type { MetricRecord } from "../../types";
import { Tag } from "../atoms/Tag";
import { useI18n } from "../../i18n";

export interface MetricCardProps {
  metric: MetricRecord;
  rank: number;
  selected?: boolean;
  /** Opens the metric preview, which lists the reports. */
  onOpen?: (metric: MetricRecord) => void;
}

/**
 * One BI metric (scene 4f): name, id, domain and a two-line definition. The
 * reports that use it are listed only in the preview, so the card keeps the
 * same height as the others. The name is the button that opens the preview;
 * it stretches over the card. Like the Archive card, it leads with source and type.
 */
export function MetricCard({ metric, rank, selected = false, onOpen }: MetricCardProps) {
  const { t, s } = useI18n();
  return (
    <article className={`mm-card mm-archive mm-metric${selected ? " selected" : ""}`} aria-label={t("card.result", { rank })} data-metric-id={metric.metric_id}>
      <div className="mm-body">
        <div className="mm-archive-head mm-mono">
          <span className="mm-source-name">{t("card.biSource")}</span><span>{t("card.metric")}</span>
        </div>
        <button type="button" className="mm-name mm-card-link" onClick={() => onOpen?.(metric)}>{s(metric.name)}</button>
        <div className="mm-mono">
          <Tag>{metric.metric_id}</Tag>
          {metric.domain && <Tag>{s(metric.domain)}</Tag>}
        </div>
        {metric.definition && <div className="mm-text mm-definition">{s(metric.definition)}</div>}
      </div>
    </article>
  );
}
