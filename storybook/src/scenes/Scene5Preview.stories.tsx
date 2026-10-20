import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { PreviewPanel } from "../components/organisms/PreviewPanel";
import { ResultGrid } from "../components/organisms/ResultGrid";
import { annotations, duration, hits, kitchenFaces, kitchenFrame, people, scenes } from "../mock/data";

const meta = {
  title: "Scenes/5 · Preview",
  parameters: { layout: "fullscreen", docs: { description: { component: "Open a hit to see the matched moment, step with ← →, close with Esc. Status: **partial** (the console plays the file but does not seek to the scene)." } } },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Flow: Story = {
  render: () => {
    const [index, setIndex] = useState<number | null>(0);
    const [playhead, setPlayhead] = useState(44);
    const hit = index === null ? null : hits[index]!;
    return (
      <div style={{ padding: 20, display: "grid", gap: 14 }}>
        {hit && index !== null && (
          <PreviewPanel hit={hit} position={index + 1} total={hits.length} frameSrc={hit.thumb_url ?? kitchenFrame}
            faces={index === 0 ? kitchenFaces.slice(0, 2) : []} people={people} annotations={annotations} scenes={scenes}
            duration={duration} playhead={playhead} onSeek={setPlayhead}
            onPrev={() => setIndex((i) => Math.max(0, (i ?? 0) - 1))} onNext={() => setIndex((i) => Math.min(hits.length - 1, (i ?? 0) + 1))}
            onClose={() => setIndex(null)} />
        )}
        <ResultGrid hits={hits} people={people} selectedId={hit?.unit_id ?? null} onOpen={(h) => setIndex(hits.findIndex((x) => x.unit_id === h.unit_id))} />
      </div>
    );
  },
};
