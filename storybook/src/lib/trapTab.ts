import type { KeyboardEvent } from "react";

const FOCUSABLE = "a[href], button:not(:disabled), input, select, textarea, video[controls], [tabindex]:not([tabindex='-1'])";

/** Keeps Tab inside a modal: from the last control it wraps to the first, and Shift+Tab the other way. */
export function trapTab(event: KeyboardEvent, root: HTMLElement | null) {
  const items = [...(root?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
  const first = items[0], last = items[items.length - 1];
  if (!first || !last) { event.preventDefault(); return; }
  const active = document.activeElement;
  if (event.shiftKey && (active === first || active === root)) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
}
