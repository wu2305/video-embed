import type { LabelHTMLAttributes } from "react";

/** Small uppercase caption. Use `htmlFor` for a control, or `as="span"` for a group heading. */
export function Label({ as = "label", ...rest }: LabelHTMLAttributes<HTMLElement> & { as?: "label" | "span" }) {
  const Tag = as;
  return <Tag className="mm-label" {...(rest as object)} />;
}
