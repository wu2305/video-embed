import type { ButtonHTMLAttributes } from "react";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** `primary` is the single submit action of a form. `ghost` is for dismissals. */
  variant?: "default" | "primary" | "ghost";
}

/** The console button. At most one `primary` per form. */
export function Button({ variant = "default", className, type = "button", ...rest }: ButtonProps) {
  const cls = [variant === "primary" ? "mm-primary" : variant === "ghost" ? "mm-ghost" : "", className].filter(Boolean).join(" ");
  return <button type={type} className={cls || undefined} {...rest} />;
}
