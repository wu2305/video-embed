import type { ReactNode } from "react";

/** One chip of the "who / what" read-out. The bold part is the interpreted value. */
export function ParseStep({ tone, children }: { tone?: "accent" | "bad"; children: ReactNode }) {
  return <span className={`mm-step${tone ? ` ${tone}` : ""}`}>{children}</span>;
}
