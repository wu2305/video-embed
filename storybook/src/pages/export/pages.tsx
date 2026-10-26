import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SearchPage } from "../SearchPage";
import {
  archiveRecords, metricRecords, documentHits as corpus, indexInfo, now, viewer,
} from "../../mock/data";

/** A page to export as a static showcase card. `width`/`height` are the layout size in px. */
export interface ExportedPage {
  name: string;
  title: string;
  summary: string;
  story: string;
  width: number;
  element: ReactElement;
}

const shared = { index: indexInfo, now, viewer };

/** The pages shown as examples in the design system, with the same data as their stories. */
export const PAGES: ExportedPage[] = [
  {
    name: "SearchStartPage", title: "Search · first visit", story: "pages-search--first-visit", width: 1280,
    summary: "The search home before any query: the brand, one large search field and when the index was last updated.",
    element: <SearchPage {...shared} people={[]} corpus={corpus} archive={archiveRecords} metrics={metricRecords} />,
  },
  {
    name: "SearchResultsPage", title: "Search · results", story: "pages-search--results", width: 1280,
    summary: "The Search page after “budget”: the status line and NAS, Archive and BI results fused into one grid.",
    element: <SearchPage {...shared} people={[]} corpus={corpus} archive={archiveRecords} metrics={metricRecords} initialQuery="budget" />,
  },
  {
    name: "SearchPreviewPage", title: "Search · preview open", story: "pages-search--preview-open", width: 1280,
    summary: "A NAS document opened in the preview dialog.",
    element: <SearchPage {...shared} people={[]} corpus={corpus} archive={archiveRecords} metrics={metricRecords} initialQuery="budget" openId={201} />,
  },
  {
    name: "SearchPhonePage", title: "Search · phone", story: "pages-search--results", width: 390,
    summary: "The Search results page at 390px: the form stacks and the grid drops to two columns.",
    element: <SearchPage {...shared} people={[]} corpus={corpus} archive={archiveRecords} metrics={metricRecords} initialQuery="budget" />,
  },
];

export function render(page: ExportedPage): string {
  return renderToStaticMarkup(page.element);
}
