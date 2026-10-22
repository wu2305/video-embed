import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { PreviewPanel } from "./PreviewPanel";
import { annotations, cookingHit, duration, hitFaces, hits, kitchenFaces, kitchenFrame, people, photoHit, presentingHit, scenes } from "../../mock/data";
import type { Hit } from "../../types";

const meta = {
  title: "Organisms/PreviewPanel",
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
        faces={hitFaces(hit)}
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
    hit: cookingHit, position: 1, total: 4, frameSrc: kitchenFrame, faces: kitchenFaces,
    people, annotations, scenes, duration, playhead: 50,
  },
};

/** An image has no timeline and no seek. */
export const Image: Story = {
  args: { hit: photoHit, position: 3, total: 4, frameSrc: photoHit.thumb_url!, people, faces: hitFaces(photoHit) },
};

/** The file's permissions changed since last night: no frame, no text, no Open clip. */
export const AccessRevoked: Story = {
  args: { hit: cookingHit, position: 1, total: 4, frameSrc: kitchenFrame, people, unavailable: "forbidden" },
};

/** The file was deleted or moved on the NAS after the snapshot was published. */
export const FileGone: Story = {
  args: { hit: presentingHit, position: 2, total: 4, frameSrc: kitchenFrame, people, unavailable: "gone" },
};
