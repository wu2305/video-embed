import { useMemo, useState } from "react";
import type { ParsedQuery, Person } from "../../types";
import { parseQuery } from "../../lib/parseQuery";
import { Button } from "../atoms/Button";
import { Field } from "../molecules/Field";
import { ParseStep } from "../molecules/ParseStep";
import { useI18n } from "../../i18n";
import { useSubmitReason } from "../../lib/useSubmitReason";

export interface SearchParams {
  query: string;
  parsed: ParsedQuery;
  limit: number;
  min_faces: number;
}

export interface SearchBarProps {
  people: readonly Person[];
  initialQuery?: string;
  busy?: boolean;
  /** The search home: one large field and the button, no limit or face filters. */
  home?: boolean;
  onSearch?: (params: SearchParams) => void;
}

/**
 * The console form plus scene 3's "who / what" readout. People are named in
 * the query itself ("Ana and Ben are cooking"), never picked by cluster id;
 * the readout shows who will be filtered and what will be embedded.
 */
export function SearchBar({ people, initialQuery = "", busy = false, home = false, onSearch }: SearchBarProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState(initialQuery);
  const [limit, setLimit] = useState(12);
  const [minFaces, setMinFaces] = useState(0);
  const parsed = useMemo(() => parseQuery(query, people), [query, people]);
  const hasWho = parsed.who.length > 0 || parsed.unresolved.length > 0;
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
    onSearch?.({ query: query.trim(), parsed, limit, min_faces: minFaces });
  }

  // Busy keeps the label and adds a spinner; aria-disabled and the status line carry the state.
  const submitProps = { variant: "primary" as const, type: "submit" as const, className: busy ? "mm-busy" : undefined, ...buttonProps };
  const spinner = busy && <span className="mm-spinner" aria-hidden="true" />;
  const readout = hasWho && (
    <div className="mm-parse" aria-live="polite">
      {parsed.who.map((name, i) => <ParseStep key={name} tone="accent">{t("search.parse.who")} <b>{name}</b></ParseStep>)}
      {parsed.unresolved.map((name) => <ParseStep key={name} tone="bad">{t("search.parse.unknown")} <b>{name}</b></ParseStep>)}
      {parsed.unresolved.length === 0 && <ParseStep>{t("search.parse.what")} <b>{parsed.what}</b></ParseStep>}
    </div>
  );

  if (home) {
    return (
      <form className="mm-home-search" onSubmit={submit} role="search" aria-label={t("search.region")}>
        <div className="mm-home-field">
          <input type="search" aria-label={t("search.fieldLabel")} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("search.placeholder")} autoComplete="off" />
          <Button {...submitProps}>{spinner}{t("search.submitHome")}</Button>
        </div>
        {readout}
        {why}
      </form>
    );
  }

  return (
    <form className="mm-panel" onSubmit={submit} role="search" aria-label={t("search.region")}>
      <div className="mm-search">
        <Field label={t("search.query")} grow>
          <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("search.placeholder")} autoComplete="off" />
        </Field>
        <Field label={t("search.limit")}>
          <input type="number" min={1} max={60} value={limit} onChange={(e) => setLimit(Number(e.target.value))} style={{ width: 80 }} />
        </Field>
        <Field label={t("search.minFaces")}>
          <input type="number" min={0} max={20} value={minFaces} onChange={(e) => setMinFaces(Number(e.target.value))} style={{ width: 90 }} />
        </Field>
        <Button {...submitProps}>{spinner}{t("search.submit")}</Button>
      </div>
      {readout}
      {why}
    </form>
  );
}
