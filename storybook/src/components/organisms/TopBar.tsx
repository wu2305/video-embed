import type { IndexInfo, Viewer } from "../../types";
import { Freshness } from "../molecules/Freshness";

export type PageId = "search" | "people" | "clip";

export interface TopBarProps {
  current: PageId;
  /** The published NAS snapshot. Omit before the first export. */
  index?: IndexInfo;
  /** Epoch seconds, for "updated today 02:40". */
  now?: number;
  /** The signed-in user. Every page needs one; the gateway has no anonymous access. */
  viewer?: Viewer;
  onNavigate?: (page: PageId) => void;
  /** Leave out the product name, for a page that shows it large itself (the search home). */
  hideBrand?: boolean;
}

const LINKS: { id: PageId; label: string }[] = [
  { id: "search", label: "Search" },
  { id: "people", label: "People" },
];

function initials(name: string): string {
  return name.split(/\s+/).map((part) => part[0] ?? "").join("").slice(0, 2).toUpperCase();
}

/** A keyframe with a face box in it: what the console finds. */
export function BrandMark() {
  return (
    <svg className="mm-brand-mark" viewBox="0 0 18 18" aria-hidden focusable="false">
      <rect x="1" y="3" width="16" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <rect x="6.5" y="6" width="5" height="5.5" rx="1" fill="currentColor" />
    </svg>
  );
}

/** App header: product mark, primary navigation, how fresh the NAS index is, and who is signed in. */
export function TopBar({ current, index, now, viewer, onNavigate, hideBrand = false }: TopBarProps) {
  return (
    <header className="mm-topbar">
      {!hideBrand && <div className="mm-brand"><BrandMark /><span className="mm-brand-name">Unified Search</span></div>}
      <nav aria-label="Primary" className="mm-links">
        {LINKS.map((link) => (
          <a
            key={link.id}
            href={`#${link.id}`}
            aria-current={current === link.id || (link.id === "search" && current === "clip") ? "page" : undefined}
            onClick={(e) => { e.preventDefault(); onNavigate?.(link.id); }}
          >
            {link.label}
          </a>
        ))}
      </nav>
      {index && <Freshness index={index} now={now} />}
      {viewer && (
        <span className="mm-viewer" title={`Signed in as ${viewer.name} · groups: ${viewer.groups.join(", ")}`}>
          <span className="mm-avatar" aria-hidden>{initials(viewer.name)}</span>
          <span className="mm-viewer-name">{viewer.name}</span>
        </span>
      )}
    </header>
  );
}
