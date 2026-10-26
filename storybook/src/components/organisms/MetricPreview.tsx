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

/** What the preview asks `/api/bi/metrics/{id}/reports` for. */
export interface ReportsRequest {
  q: string;
  offset: number;
  limit: number;
}

/** Reports per page. Ten rows keep the dialog short enough that the pager stays in view. */
export const REPORTS_PAGE = 10;

export interface MetricPreviewProps {
  metric: MetricRecord;
  /**
   * The page of reports asked for last, from `/api/bi/metrics/{id}/reports`.
   * Null while it loads; on the first page the card's top reports show meanwhile.
   */
  reports?: readonly MetricReport[] | null;
  /** Reports that match the filter, from the same response. Defaults to the metric's `report_count`. */
  total?: number;
  /** Position of the page's first report. */
  offset?: number;
  pageSize?: number;
  /** Asks for another page or filter. The caller fetches it and passes the answer back. */
  onRequest?: (request: ReportsRequest) => void;
  /** The reports request failed. */
  error?: boolean;
  /** Runs the failed request again. */
  onRetry?: () => void;
  onClose?: () => void;
  /** Takes focus when it opens and keeps Tab inside itself. The caller makes the page behind it inert. */
  modal?: boolean;
}

/** Lists with more reports than this get a filter field. */
const FILTER_FROM = 6;
/** The filter asks the server once typing pauses. */
const FILTER_WAIT = 250;

/**
 * Scene 4f: a BI metric and every report that uses it. Each report opens in
 * the BI platform; Open in BI opens the metric's own page there.
 */
export function MetricPreview({
  metric, reports = null, total = metric.report_count, offset = 0, pageSize = REPORTS_PAGE, onRequest,
  error = false, onRetry, onClose, modal = false,
}: MetricPreviewProps) {
  const { t, s } = useI18n();
  const dialog = useRef<HTMLDivElement>(null);
  const [filter, setFilter] = useState("");
  const asked = useRef("");

  useEffect(() => {
    if (modal) dialog.current?.focus({ preventScroll: true });
  }, [modal]);

  // A new filter starts again from the first page.
  useEffect(() => {
    const q = filter.trim();
    if (q === asked.current) return;
    const timer = setTimeout(() => { asked.current = q; onRequest?.({ q, offset: 0, limit: pageSize }); }, FILTER_WAIT);
    return () => clearTimeout(timer);
  }, [filter]);

  function turn(to: number) {
    if (to < 0 || to >= total || reports === null) return;
    onRequest?.({ q: asked.current, offset: to, limit: pageSize });
  }

  function keys(event: React.KeyboardEvent) {
    if (event.key === "Escape") { event.preventDefault(); onClose?.(); }
    else if (event.key === "Tab" && modal) trapTab(event, dialog.current);
  }

  const loading = reports === null && !error;
  // Until the first page arrives the card's top reports stand in for it; a
  // later page or filter shows only the placeholder, so no stale row reads as live.
  const first = offset === 0 && !asked.current;
  const shown = reports ?? (first ? metric.reports : []);
  const paged = total > pageSize && !error;
  const last = Math.min(offset + pageSize, total);

  return (
    <div ref={dialog} className="mm-metric-preview" role="dialog" aria-modal={modal || undefined}
      aria-label={t("preview.label", { name: metric.name })} tabIndex={-1} onKeyDown={keys}>
      <h2>{s(metric.name)}</h2>
      <div className="mm-mono">
        <Tag>{metric.metric_id}</Tag>
        {metric.domain && <Tag>{s(metric.domain)}</Tag>}
      </div>
      {metric.definition && <p className="mm-text">{s(metric.definition)}</p>}
      {metric.owner && <MetaList items={[[t("metric.owner"), metric.owner]]} />}

      <section aria-label={t("metric.reports")} aria-busy={loading || undefined}>
        <div className="mm-metric-bar">
          <h3>{t("metric.reports")}</h3>
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
                <a href={r.deep_link} target="_blank" rel="noopener noreferrer">{s(r.title)} ↗</a>
                <span className="mm-mono mm-text">
                  {[r.kind === "dashboard" && t("metric.dashboard"), r.folder && s(r.folder), r.owner,
                    r.charts === 1 ? t("metric.chart") : t("metric.charts", { count: r.charts }), formatDate(r.updated_at)]
                    .filter(Boolean).join(" · ")}
                </span>
              </li>
            ))}
          </ul>
        )}
        {loading && <div className="mm-skeleton mm-report-skeleton" aria-hidden><span /><span /></div>}
        {reports !== null && asked.current && total === 0 && <div className="mm-empty">{t("metric.noMatch")}</div>}
        {paged && (
          <nav className="mm-pager" aria-label={t("metric.pages")}>
            <Button aria-disabled={offset === 0 || loading || undefined} onClick={() => turn(offset - pageSize)}>{t("pager.previous")}</Button>
            <span className="mm-text" aria-live="polite">{t("metric.range", { from: offset + 1, to: last, total })}</span>
            <Button aria-disabled={last >= total || loading || undefined} onClick={() => turn(offset + pageSize)}>{t("pager.next")}</Button>
          </nav>
        )}
      </section>

      <div className="mm-row">
        <a className="mm-button" href={metric.deep_link} target="_blank" rel="noopener noreferrer">{t("metric.openInBi")}</a>
        <Button variant="ghost" onClick={onClose}>{t("preview.close")} <Kbd>Esc</Kbd></Button>
      </div>
    </div>
  );
}
