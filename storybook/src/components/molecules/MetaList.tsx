import type { ReactNode } from "react";

/** Key/value facts about a file or unit, as a description list. */
export function MetaList({ items }: { items: readonly (readonly [string, ReactNode])[] }) {
  return (
    <dl className="mm-meta">
      {items.map(([key, value]) => (
        <div key={key} style={{ display: "contents" }}>
          <dt>{key}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
