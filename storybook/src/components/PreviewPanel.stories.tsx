import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { PreviewPanel } from "./PreviewPanel";
import { annotations, cookingHit, duration, hits, kitchenFaces, kitchenFrame, people, photoHit, scenes } from "../mock/data";
import type { Hit } from "../types";

const meta = {
  title: "Scene 5 · Preview/PreviewPanel",
  component: PreviewPanel,
  parameters: { layout: "fullscreen" },
  decorators: [(Story) => <div style={{ padding: 20 }}><Story /></div>],
} satisfies Meta<typeof PreviewPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Arrow keys step through hits, Esc closes. Poster frames stand in for the video. */
export const Stepping: Story = {
  args: { hit: cookingHit, position: 1, total: hits.length, frameSrc: kitchenFrame },
  render: () => {
    const [index, setIndex] = useState(0);
    const [playhead, setPlayhead] = useState(44);
    const hit: Hit = hits[index]!;
    return (
      <PreviewPanel
        hit={hit}
        position={index + 1}
        total={hits.length}
        frameSrc={hit.thumb_url ?? kitchenFrame}
        faces={index === 0 ? kitchenFaces.slice(0, 2) : []}
        people={people}
        annotations={annotations}
        scenes={scenes}
        duration={duration}
        playhead={playhead}
        onSeek={setPlayhead}
        onPrev={() => setIndex((i) => Math.max(0, i - 1))}
        onNext={() => setIndex((i) => Math.min(hits.length - 1, i + 1))}
      />
    );
  },
};

/** The note under the playhead is drawn over the frame. */
export const WithNoteOverlay: Story = {
  args: {
    hit: cookingHit, position: 1, total: 4, frameSrc: kitchenFrame, faces: kitchenFaces.slice(0, 2),
    people, annotations, scenes, duration, playhead: 50,
  },
};

/** An image has no timeline and no seek. */
export const Image: Story = {
  args: { hit: photoHit, position: 3, total: 4, frameSrc: photoHit.thumb_url!, people, faces: kitchenFaces.slice(0, 3) },
};
