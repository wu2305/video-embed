import { useEffect, useRef, useState } from "react";
import type { MetricRecord, MetricReport } from "../../types";
import { formatDate } from "../../lib/format";
import { trapTab } from "../../lib/trapTab";
import { Button } from "../atoms/Button";
import { Kbd } from "../atoms/Kbd";
import { Tag } from "../atoms/Tag";
import { Field } from "../molecules/Field";
import { MetaList } from "../molecules/MetaList";
import { useI18n } from "../../i18n";

export interface MetricPreviewProps {
  metric: MetricRecord;
  /**
   * Every report that uses the metric, from `/api/bi/metrics/{id}/reports`.
   * Null while it loads; the card's first reports show meanwhile.
   */
  reports?: readonly MetricReport[] | null;
  /** The reports request failed. */
  error?: boolean;
  onRetry?: () => void;
  onClose?: () => void;
  /** Takes focus when it opens and keeps Tab inside itself. The caller makes the page behind it inert. */
  modal?: boolean;
}

/** Lists with more reports than this get a filter field. */
const FILTER_FROM = 6;

/**
 * Scene 4f: a BI metric and every report that uses it. Each report opens in
 * the BI platform; Open in BI opens the metric's own page there.
 */
export function MetricPreview({ metric, reports = null, error = false, onRetry, onClose, modal = false }: MetricPreviewProps) {
  const { t } = useI18n();
  const dialog = useRef<HTMLDivElement>(null);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    if (modal) dialog.current?.focus({ preventScroll: true });
  }, [modal]);

  function keys(event: React.KeyboardEvent) {
    if (event.key === "Escape") { event.preventDefault(); onClose?.(); }
    else if (event.key === "Tab" && modal) trapTab(event, dialog.current);
  }

  const loading = reports === null && !error;
  const all = reports ?? metric.reports;
  const wanted = filter.trim().toLowerCase();
  const shown = wanted
    ? all.filter((r) => `${r.title} ${r.folder ?? ""} ${r.owner ?? ""}`.toLowerCase().includes(wanted))
    : all;

  return (
    <div ref={dialog} className="mm-metric-preview" role="dialog" aria-modal={modal || undefined}
      aria-label={t("preview.label", { name: metric.name })} tabIndex={-1} onKeyDown={keys}>
      <h2>{metric.name}</h2>
      <div className="mm-mono">
        <Tag>{metric.metric_id}</Tag>
        {metric.domain && <Tag>{metric.domain}</Tag>}
      </div>
      {metric.definition && <p className="mm-text">{metric.definition}</p>}
      {metric.owner && <MetaList items={[[t("metric.owner"), metric.owner]]} />}

      <section aria-label={t("metric.reports")} aria-busy={loading || undefined}>
        <div className="mm-metric-bar">
          <h3>{metric.report_count === 0 ? t("card.noReports") : t("metric.reports")}</h3>
          {metric.report_count >= FILTER_FROM && !error && (
            <Field label={t("metric.filter")}>
              <input type="search" value={filter} onChange={(e) => setFilter(e.target.value)} />
            </Field>
          )}
        </div>
        {error && (
          <div className="mm-notice bad" role="alert">
            <p style={{ margin: 0 }}>{t("metric.reportsFailed")}</p>
            {onRetry && <div className="mm-row" style={{ marginTop: 8 }}><Button onClick={onRetry}>{t("results.retry")}</Button></div>}
          </div>
        )}
        {shown.length > 0 && (
          <ul className="mm-report-rows">
            {shown.map((r) => (
              <li key={r.report_id}>
                <a href={r.deep_link} target="_blank" rel="noopener noreferrer">{r.title} ↗</a>
                <span className="mm-mono mm-text">
                  {[r.kind === "dashboard" && t("metric.dashboard"), r.folder, r.owner,
                    r.charts === 1 ? t("metric.chart") : t("metric.charts", { count: r.charts }), formatDate(r.updated_at)]
                    .filter(Boolean).join(" · ")}
                </span>
              </li>
            ))}
          </ul>
        )}
        {loading && <div className="mm-skeleton mm-report-skeleton" aria-hidden><span /><span /></div>}
        {wanted && shown.length === 0 && <div className="mm-empty">{t("metric.noMatch")}</div>}
      </section>

      <div className="mm-row">
        <a className="mm-button" href={metric.deep_link} target="_blank" rel="noopener noreferrer">{t("metric.openInBi")}</a>
        <Button variant="ghost" onClick={onClose}>{t("preview.close")} <Kbd>Esc</Kbd></Button>
      </div>
    </div>
  );
}
