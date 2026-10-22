import type { HTMLAttributes } from "react";

export interface PanelProps extends HTMLAttributes<HTMLElement> {
  /** Use `section` with a heading for a landmark region, `div` for plain grouping. */
  as?: "div" | "section" | "aside";
  /** Optional heading, set in the panel's top-left. */
  title?: string;
}

/** The raised surface: `panel` fill, `line` border, `radius-lg`. Do not nest panels. */
export function Panel({ as = "div", title, className, children, ...rest }: PanelProps) {
  const Tag = as;
  return (
    <Tag className={["mm-panel", className].filter(Boolean).join(" ")} {...rest}>
      {title && <h2>{title}</h2>}
      {children}
    </Tag>
  );
}
