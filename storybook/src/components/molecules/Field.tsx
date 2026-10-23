import { useId, type ReactElement, cloneElement } from "react";
import { Label } from "../atoms/Label";

export interface FieldProps {
  label: string;
  /** One input, select or textarea. Its `id` is wired to the label. */
  children: ReactElement<{ id?: string }>;
  grow?: boolean;
  /** Keep the label for screen readers only, when the control explains itself. */
  hideLabel?: boolean;
}

/** Label + control stacked with a 5px gap. */
export function Field({ label, children, grow = false, hideLabel = false }: FieldProps) {
  const auto = useId();
  const id = children.props.id ?? auto;
  return (
    <div className={`mm-field${grow ? " mm-grow" : ""}`}>
      <Label htmlFor={id} {...(hideLabel && { className: "mm-label mm-sr-only" })}>{label}</Label>
      {cloneElement(children, { id })}
    </div>
  );
}
