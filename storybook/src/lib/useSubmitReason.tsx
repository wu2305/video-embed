import { useId, useState } from "react";

/**
 * A submit that cannot run yet stays focusable and names its reason (see
 * Layout, "Controls and touch"). Spread `buttonProps` on the submit button,
 * render `why` after it, and call `blocked()` first in the submit handler:
 * while there is a reason it shows it, moves focus to the field to fix, and
 * returns true.
 */
export function useSubmitReason(reason: string | null, fix?: () => HTMLElement | null | undefined) {
  const id = useId();
  const [tried, setTried] = useState(false);
  return {
    blocked(): boolean {
      if (!reason) { setTried(false); return false; }
      setTried(true);
      fix?.()?.focus();
      return true;
    },
    buttonProps: { "aria-disabled": reason ? true : undefined, "aria-describedby": reason ? id : undefined },
    why: reason && <p id={id} className={tried ? "mm-hint mm-why" : "mm-sr-only"} aria-live="polite">{reason}</p>,
  };
}
