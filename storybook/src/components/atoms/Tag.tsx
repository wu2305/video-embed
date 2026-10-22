import type { HTMLAttributes } from "react";

export interface TagProps extends HTMLAttributes<HTMLSpanElement> {
  /** `good` scene ranges, `accent` named people, `warn` caution, `bad` errors. */
  tone?: "neutral" | "good" | "accent" | "warn" | "bad";
}

/** Mono pill for metadata. Keep to one or two words; colour never stands alone. */
export function Tag({ tone = "neutral", className, ...rest }: TagProps) {
  return <span className={["mm-tag", tone === "neutral" ? "" : tone, className].filter(Boolean).join(" ")} {...rest} />;
}
