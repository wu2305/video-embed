import type { IndexInfo } from "../../types";
import { formatDate, formatUpdated } from "../../lib/format";
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
  const updated = formatUpdated(index.published_at, now);
  if (index.stale) {
    return (
      <span className={long ? "mm-hint" : "mm-mono"} role={long ? "alert" : undefined}>
        <Tag tone="warn">stale</Tag>
        {long
          ? `The NAS index has not been updated since ${formatDate(index.published_at)}. Results are still correct for files that existed then; newer files are missing. IT has been alerted.`
          : `not updated since ${formatDate(index.published_at)}`}
      </span>
    );
  }
  if (!long) return <span className="mm-mono">{index.units.toLocaleString("en-US")} items · updated {updated}</span>;
  return (
    <span className="mm-hint">
      NAS index updated {updated}. Files added to the NAS today become searchable tomorrow morning, after the nightly update.
    </span>
  );
}
