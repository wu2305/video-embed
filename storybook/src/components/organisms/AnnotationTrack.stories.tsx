import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { AnnotationTrack } from "./AnnotationTrack";
import { annotations, duration, scenes } from "../../mock/data";

const meta = {
  title: "Organisms/AnnotationTrack",
  component: AnnotationTrack,
  args: { duration, scenes, annotations, playhead: 50 },
  render: (args) => {
    const [playhead, setPlayhead] = useState(args.playhead ?? 0);
    return <AnnotationTrack {...args} playhead={playhead} onSeek={setPlayhead} />;
  },
} satisfies Meta<typeof AnnotationTrack>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Click or use ←/→ to move the playhead. Yellow bars are notes. */
export const Default: Story = {};

/** The green band is the scene the search matched. */
export const WithMatch: Story = { args: { matched: { start: 42, end: 71 } } };

export const NoNotes: Story = { args: { annotations: [] } };
