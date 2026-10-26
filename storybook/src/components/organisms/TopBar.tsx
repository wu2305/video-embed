import type { IndexInfo, Viewer } from "../../types";
import { useI18n, type MessageKey } from "../../i18n";
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

// People and Clip are media pages, hidden while no customer searches media.
const LINKS: { id: PageId; label: MessageKey }[] = [
  { id: "search", label: "nav.search" },
];

function initials(name: string): string {
  return name.split(/\s+/).map((part) => part[0] ?? "").join("").slice(0, 2).toUpperCase();
}

/** A magnifier: one search over every source. */
export function BrandMark() {
  return (
    <svg className="mm-brand-mark" viewBox="0 0 18 18" aria-hidden focusable="false">
      <circle cx="7.5" cy="7.5" r="5.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M11.5 11.5 16 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/** App header: product mark, primary navigation, how fresh the NAS index is, and who is signed in. */
export function TopBar({ current, index, now, viewer, onNavigate, hideBrand = false }: TopBarProps) {
  const { t, s } = useI18n();
  return (
    <header className="mm-topbar">
      {!hideBrand && <div className="mm-brand"><BrandMark /><span className="mm-brand-name">{t("brand.name")}</span></div>}
      <nav aria-label={t("nav.primary")} className="mm-links">
        {LINKS.map((link) => (
          <a
            key={link.id}
            href={`#${link.id}`}
            aria-current={current === link.id || (link.id === "search" && current === "clip") ? "page" : undefined}
            onClick={(e) => { e.preventDefault(); onNavigate?.(link.id); }}
          >
            {t(link.label)}
          </a>
        ))}
      </nav>
      {index && <Freshness index={index} now={now} />}
      {viewer && (
        <span className="mm-viewer" title={t("viewer.signedIn", { name: viewer.name, groups: viewer.groups.map(s).join(t("viewer.groupSep")) })}>
          <span className="mm-avatar" aria-hidden>{initials(viewer.name)}</span>
          <span className="mm-viewer-name">{viewer.name}</span>
        </span>
      )}
    </header>
  );
}
