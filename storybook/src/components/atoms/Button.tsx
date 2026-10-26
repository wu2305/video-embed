import type { ButtonHTMLAttributes } from "react";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /**
   * `primary` is the single submit action of a form. `ghost` is for dismissals.
   * `danger` is for an action that changes what other people see and cannot be
   * taken back silently, such as deleting something others rely on.
   */
  variant?: "default" | "primary" | "ghost" | "danger";
}

const CLASS: Record<NonNullable<ButtonProps["variant"]>, string> = {
  default: "mm-button", primary: "mm-primary", ghost: "mm-ghost", danger: "mm-danger",
};

/** The console button. At most one `primary` per form. */
export function Button({ variant = "default", className, type = "button", ...rest }: ButtonProps) {
  return <button type={type} className={[CLASS[variant], className].filter(Boolean).join(" ")} {...rest} />;
}
