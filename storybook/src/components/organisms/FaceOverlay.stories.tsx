import type { Meta, StoryObj } from "@storybook/react-vite";
import { FaceOverlay } from "./FaceOverlay";
import { kitchenFaces, kitchenFrame, people } from "../../mock/data";

const meta = {
  title: "Organisms/FaceOverlay",
  component: FaceOverlay,
  args: { faces: kitchenFaces, people },
  render: (args) => (
    <div className="mm-stage" style={{ maxWidth: 560 }}>
      <img src={kitchenFrame} alt="Kitchen keyframe" />
      <FaceOverlay {...args} />
    </div>
  ),
} satisfies Meta<typeof FaceOverlay>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Display-only boxes, as shown over a preview. Named, unnamed cluster and untagged all differ. */
export const DisplayOnly: Story = {};

export const Selectable: Story = { args: { onSelect: () => {}, selectedIndex: 1 } };
