import type { ReactNode } from "react";
import type { IndexInfo, Viewer } from "../../types";
import { TopBar, type PageId } from "../organisms/TopBar";

export interface AppShellProps {
  current: PageId;
  title: string;
  /** Keep the heading for screen readers only, when the page already says where you are. */
  hideTitle?: boolean;
  /** One line under the title. */
  subtitle?: ReactNode;
  /** Breadcrumb above the title, for detail pages. */
  crumbs?: ReactNode;
  /** Buttons at the right of the page header. */
  actions?: ReactNode;
  index?: IndexInfo;
  now?: number;
  viewer?: Viewer;
  onNavigate?: (page: PageId) => void;
  /** Set while a modal dialog is open over the page: the page takes no focus or clicks. */
  inert?: boolean;
  children: ReactNode;
}

/** Every page: top bar, a centred column with a header, then the page body. */
export function AppShell({ current, title, hideTitle = false, subtitle, crumbs, actions, index, now, viewer, onNavigate, inert = false, children }: AppShellProps) {
  return (
    <div className="mm-shell" inert={inert || undefined}>
      <TopBar current={current} index={index} now={now} viewer={viewer} onNavigate={onNavigate} />
      <main className="mm-page">
        <div className="mm-page-head">
          <div>
            {crumbs && <div className="mm-crumbs">{crumbs}</div>}
            <h1 className={hideTitle ? "mm-sr-only" : undefined}>{title}</h1>
            {subtitle && <p>{subtitle}</p>}
          </div>
          {actions && <div className="mm-toolbar">{actions}</div>}
        </div>
        {children}
      </main>
    </div>
  );
}
