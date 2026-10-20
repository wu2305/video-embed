export type PageId = "search" | "people" | "clip";

export interface TopBarProps {
  current: PageId;
  /** Indexed units in the published snapshot. */
  units?: number;
  snapshot?: string;
  onNavigate?: (page: PageId) => void;
}

const LINKS: { id: PageId; label: string }[] = [
  { id: "search", label: "Search" },
  { id: "people", label: "People" },
];

/** App header: product mark, primary navigation and the snapshot the console is reading. */
export function TopBar({ current, units, snapshot, onNavigate }: TopBarProps) {
  return (
    <header className="mm-topbar">
      <div className="mm-brand"><span className="mm-brand-mark" aria-hidden />mmindex</div>
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
      {units !== undefined && (
        <span className="mm-mono">{units.toLocaleString("en-US")} units{snapshot && ` · snapshot ${snapshot}`}</span>
      )}
    </header>
  );
}
