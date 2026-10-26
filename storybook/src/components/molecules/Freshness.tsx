import type { IndexInfo } from "../../types";
import { formatDate, formatUpdated } from "../../lib/format";
import { useI18n } from "../../i18n";
import { Tag } from "../atoms/Tag";

export interface FreshnessProps {
  index: IndexInfo;
  /** Epoch seconds; stories pin it so the wording is stable. */
  now?: number;
  /** One line for the top bar, or a sentence that says when new files show up. */
  long?: boolean;
}

/**
 * When the NAS index was last published (design doc §4.2). Ingestion is
 * nightly, so this is what tells a user why this morning's upload is missing.
 */
export function Freshness({ index, now = Date.now() / 1000, long = false }: FreshnessProps) {
  const { t, locale } = useI18n();
  const updated = formatUpdated(index.published_at, now, { today: t("time.today"), yesterday: t("time.yesterday") });
  if (index.stale) {
    return (
      <span className={long ? "mm-hint" : "mm-mono"} role={long ? "alert" : undefined}>
        <Tag tone="warn">{long
          ? t("freshness.staleLong", { date: formatDate(index.published_at) })
          : t("freshness.stale", { date: formatDate(index.published_at) })}</Tag>
      </span>
    );
  }
  if (!long) return <span className="mm-mono">{t("freshness.items", { count: index.units.toLocaleString(locale === "zh" ? "zh-CN" : "en-US"), updated })}</span>;
  return (
    <span className="mm-hint">
      {t("freshness.updated", { updated })}
    </span>
  );
}
