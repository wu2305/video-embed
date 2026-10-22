import type { ButtonHTMLAttributes } from "react";

/** Toggle pill (`aria-pressed`). Used to pick people in frame. */
export function Chip({ pressed = false, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { pressed?: boolean }) {
  return <button type="button" className={["mm-chip", className].filter(Boolean).join(" ")} aria-pressed={pressed} {...rest} />;
}
