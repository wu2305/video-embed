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
}

const LINKS: { id: PageId; label: string }[] = [
  { id: "search", label: "Search" },
  { id: "people", label: "People" },
];

function initials(name: string): string {
  return name.split(/\s+/).map((part) => part[0] ?? "").join("").slice(0, 2).toUpperCase();
}

/** App header: product mark, primary navigation, how fresh the NAS index is, and who is signed in. */
export function TopBar({ current, index, now, viewer, onNavigate }: TopBarProps) {
  return (
    <header className="mm-topbar">
      <div className="mm-brand"><span className="mm-brand-mark" aria-hidden />Unified Search</div>
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
