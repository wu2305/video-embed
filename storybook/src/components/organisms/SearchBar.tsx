import { useMemo, useState } from "react";
import type { ParsedQuery, Person, SearchType } from "../../types";
import { parseQuery } from "../../lib/parseQuery";
import { Button } from "../atoms/Button";
import { Field } from "../molecules/Field";
import { useI18n } from "../../i18n";
import { useSubmitReason } from "../../lib/useSubmitReason";

export interface SearchParams {
  query: string;
  parsed: ParsedQuery;
  limit: number;
  type: SearchType;
}

const TYPES: readonly SearchType[] = ["all", "nas", "archive", "bi"];

export interface SearchBarProps {
  people: readonly Person[];
  initialQuery?: string;
  initialType?: SearchType;
  busy?: boolean;
  /** The search home: one large field, the type and the button, no limit. */
  home?: boolean;
  onSearch?: (params: SearchParams) => void;
}

/**
 * The console form: the query, a limit and the source to search. A query that
 * names an unknown person blocks the search.
 */
export function SearchBar({ people, initialQuery = "", initialType = "all", busy = false, home = false, onSearch }: SearchBarProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState(initialQuery);
  const [limit, setLimit] = useState(12);
  const [type, setType] = useState<SearchType>(initialType);
  const parsed = useMemo(() => parseQuery(query, people), [query, people]);
  // Why the search cannot run yet. The button stays focusable (aria-disabled,
  // not disabled) and names this reason, so a keyboard user learns what to fix.
  const reason = busy ? t("search.reason.busy")
    : !query.trim() ? t("search.reason.empty")
    : parsed.unresolved.length ? t("search.reason.unresolved", { names: parsed.unresolved.join(t("list.sep")) })
    : null;
  const { blocked, buttonProps, why } = useSubmitReason(reason);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (blocked()) return;
    onSearch?.({ query: query.trim(), parsed, limit, type });
  }

  // Busy keeps the label and adds a spinner; aria-disabled and the status line carry the state.
  const submitProps = { variant: "primary" as const, type: "submit" as const, className: busy ? "mm-busy" : undefined, ...buttonProps };
  const spinner = busy && <span className="mm-spinner" aria-hidden="true" />;
  const typeSelect = (
    <select value={type} onChange={(e) => setType(e.target.value as SearchType)} {...(home && { "aria-label": t("search.type") })}>
      {TYPES.map((k) => <option key={k} value={k}>{t(`search.type.${k}`)}</option>)}
    </select>
  );

  if (home) {
    return (
      <form className="mm-home-search" onSubmit={submit} role="search" aria-label={t("search.region")}>
        <div className="mm-home-field">
          {/* The type sits inside the field, after a divider, so the bar reads as one box and one button. */}
          <div className="mm-home-box">
            <input type="search" aria-label={t("search.fieldLabel")} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("search.placeholder")} autoComplete="off" />
            {typeSelect}
          </div>
          <Button {...submitProps}>{spinner}{t("search.submitHome")}</Button>
        </div>
        {why}
      </form>
    );
  }

  return (
    <form className="mm-panel" onSubmit={submit} role="search" aria-label={t("search.region")}>
      <div className="mm-search">
        <Field label={t("search.fieldLabel")} grow hideLabel>
          <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("search.placeholder")} autoComplete="off" />
        </Field>
        <Field label={t("search.limit")}>
          <input type="number" min={1} max={60} value={limit} onChange={(e) => setLimit(Number(e.target.value))} style={{ width: 80 }} />
        </Field>
        <Field label={t("search.type")}>{typeSelect}</Field>
        <Button {...submitProps}>{spinner}{t("search.submit")}</Button>
      </div>
      {why}
    </form>
  );
}
