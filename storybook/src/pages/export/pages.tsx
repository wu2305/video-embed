import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ClipPage } from "../ClipPage";
import { PeoplePage } from "../PeoplePage";
import { SearchPage } from "../SearchPage";
import {
  annotations, audioHit, cookingHit, documentHit, duration, hitFaces, hits, indexInfo, kitchenFrame, people, personSamples, scenes,
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

const shared = { units: indexInfo.units, snapshot: indexInfo.snapshot };
const corpus = [...hits, audioHit, documentHit];

/** The pages shown as examples in the design system, with the same data as their stories. */
export const PAGES: ExportedPage[] = [
  {
    name: "SearchStartPage", title: "Search · first visit", story: "pages-search--first-visit", width: 1280,
    summary: "The Search page before any query: the search bar and example queries instead of an empty grid.",
    element: <SearchPage {...shared} people={people} corpus={corpus} />,
  },
  {
    name: "SearchResultsPage", title: "Search · results", story: "pages-search--results", width: 1280,
    summary: "The Search page after “Ana is cooking”: the who/what read-out, the status line and the result grid.",
    element: <SearchPage {...shared} people={people} corpus={corpus} initialQuery="Ana is cooking" />,
  },
  {
    name: "SearchPreviewPage", title: "Search · preview open", story: "pages-search--preview-open", width: 1280,
    summary: "A hit opened in the preview dialog: the matched scene with named faces, the timeline and the Open clip action.",
    element: <SearchPage {...shared} people={people} corpus={corpus} initialQuery="Ana is cooking" openId={101} onOpenClip={() => {}} />,
  },
  {
    name: "PeoplePage", title: "People · named person", story: "pages-people--named-person", width: 1280,
    summary: "The People page with Ana Ruiz selected: every face cluster, the naming panel and where she appears.",
    element: <PeoplePage {...shared} people={people} samples={personSamples} corpus={[...hits, audioHit]} selectedId="person-0003" />,
  },
  {
    name: "ClipPage", title: "Clip · video", story: "pages-clip--video", width: 1280,
    summary: "One video: the matched scene with faces and the note under the playhead, the timeline, details, notes and the note form.",
    element: (
      <ClipPage {...shared} hit={cookingHit} frameSrc={kitchenFrame} faces={hitFaces(cookingHit)} people={people}
        scenes={scenes} duration={duration} annotations={annotations} initialPlayhead={50} />
    ),
  },
  {
    name: "SearchPhonePage", title: "Search · phone", story: "pages-search--results", width: 390,
    summary: "The Search results page at 390px: the form stacks and the grid drops to two columns.",
    element: <SearchPage {...shared} people={people} corpus={corpus} initialQuery="Ana is cooking" />,
  },
];

export function render(page: ExportedPage): string {
  return renderToStaticMarkup(page.element);
}
