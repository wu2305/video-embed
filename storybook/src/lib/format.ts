export function formatTime(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const m = Math.floor(whole / 60);
  const s = whole % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Parses "mm:ss" or plain seconds. Returns null when the text is not a time. */
export function parseTime(text: string): number | null {
  const match = /^\s*(?:(\d+):)?(\d+(?:\.\d+)?)\s*$/.exec(text);
  if (!match) return null;
  return Number(match[1] ?? 0) * 60 + Number(match[2]);
}

export function displayName(personId: string, people: readonly { id: string; name?: string }[]): string {
  return people.find((p) => p.id === personId)?.name ?? personId;
}

/** "Contract · 2024-03-18" style dates, in the viewer's time zone. */
export function formatDate(epochSeconds: number): string {
  const d = new Date(epochSeconds * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function clock(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * When the index was last updated, relative to `now`: "today 02:40",
 * "yesterday 02:40", or a date. Both arguments are epoch seconds.
 */
export function formatUpdated(epochSeconds: number, now: number): string {
  const d = new Date(epochSeconds * 1000);
  const today = new Date(now * 1000);
  const yesterday = new Date((now - 86_400) * 1000);
  if (d.toDateString() === today.toDateString()) return `today ${clock(d)}`;
  if (d.toDateString() === yesterday.toDateString()) return `yesterday ${clock(d)}`;
  return formatDate(epochSeconds);
}
