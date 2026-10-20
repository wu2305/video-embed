import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { AnnotationComposer } from "../components/organisms/AnnotationComposer";
import { AnnotationTrack } from "../components/organisms/AnnotationTrack";
import { FaceOverlay } from "../components/organisms/FaceOverlay";
import { annotations as seed, duration, kitchenFaces, kitchenFrame, people, scenes } from "../mock/data";
import type { Annotation } from "../types";

const meta = {
  title: "Scenes/2 · Write on the video",
  parameters: { docs: { description: { component: "Seek on the timeline, then attach a note to the scene under the playhead. Status: **new** (needs a sidecar notes store)." } } },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Flow: Story = {
  render: () => {
    const [playhead, setPlayhead] = useState(50);
    const [notes, setNotes] = useState<Annotation[]>(seed);
    const scene = scenes.find((s) => playhead >= s.start && playhead < s.end) ?? null;
    return (
      <div style={{ display: "grid", gap: 14, maxWidth: 640 }}>
        <div className="mm-stage"><img src={kitchenFrame} alt="Kitchen keyframe" /><FaceOverlay faces={kitchenFaces} people={people} /></div>
        <AnnotationTrack duration={duration} scenes={scenes} annotations={notes} playhead={playhead} matched={scene} onSeek={setPlayhead} />
        <AnnotationComposer key={scene?.start ?? "none"} time={playhead} scene={scene} inFrame={people.slice(0, 2)} people={people}
          onSave={(n) => setNotes((cur) => [...cur, { ...n, id: `n${cur.length + 1}`, author: "mei" }])} />
      </div>
    );
  },
};
