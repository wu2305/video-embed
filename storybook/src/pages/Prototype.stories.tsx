import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { ClipPage } from "./ClipPage";
import { PeoplePage } from "./PeoplePage";
import { SearchPage } from "./SearchPage";
import type { PageId } from "../components/organisms/TopBar";
import { annotations, archiveRecords, audioHit, documentHit, duration, hitFaces, hits, indexInfo, kitchenFrame, now, pendingFaces, people as seedPeople, personSamples, scenes, viewer } from "../mock/data";
import type { Hit, Person } from "../types";

const meta = {
  title: "Pages/Prototype",
  parameters: {
    layout: "fullscreen",
    docs: { description: { component: "The three pages wired together for demos. Search both sources, open a NAS hit, open its clip, name people; names carry across pages." } },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const corpus = [...hits, audioHit, documentHit];

export const ClickThrough: Story = {
  render: () => {
    const [page, setPage] = useState<PageId>("search");
    const [clip, setClip] = useState<Hit | null>(null);
    const [people, setPeople] = useState<Person[]>(seedPeople);
    const [lastQuery] = useState("Ana is cooking");
    const shared = { index: indexInfo, now, viewer, onNavigate: setPage };

    if (page === "clip" && clip) {
      return (
        <ClipPage {...shared} key={clip.unit_id} hit={clip} frameSrc={clip.thumb_url ?? kitchenFrame}
          faces={hitFaces(clip)} people={people} scenes={scenes} duration={duration}
          annotations={clip.kind === "video" ? annotations : []} onBack={() => setPage("search")} />
      );
    }
    if (page === "people") {
      return (
        <PeoplePage {...shared} people={people} samples={personSamples} corpus={corpus} pendingFaces={pendingFaces}
          onName={(id, name) => setPeople((list) => list.map((p) => (p.id === id ? { ...p, name } : p)))} />
      );
    }
    return (
      <SearchPage {...shared} people={people} corpus={corpus} archive={archiveRecords} initialQuery={lastQuery}
        onOpenClip={(h) => { setClip(h); setPage("clip"); }} />
    );
  },
};
