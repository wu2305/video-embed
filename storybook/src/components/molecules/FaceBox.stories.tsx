import type { Meta, StoryObj } from "@storybook/react-vite";
import { FaceBox } from "./FaceBox";
import { kitchenFaces, kitchenFrame } from "../../mock/data";

const meta = {
  title: "Molecules/FaceBox",
  // Media (faces, notes, clips): hidden, since no customer searches images, video or audio. Still tested.
  tags: ["!dev", "!autodocs"],
  component: FaceBox,
  args: { face: kitchenFaces[0]!, label: "Ana Ruiz" },
  render: (args) => (
    <div className="mm-stage" style={{ maxWidth: 360 }}>
      <img src={kitchenFrame} alt="Kitchen keyframe" />
      <FaceBox {...args} />
    </div>
  ),
} satisfies Meta<typeof FaceBox>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Named: Story = {};
export const Untagged: Story = { args: { face: kitchenFaces[3]!, label: "untagged" } };
export const Selected: Story = { args: { selected: true, onSelect: () => {} } };

/** When another label would cover this one, it goes under the box. */
export const LabelBelow: Story = { args: { labelPlace: "below" } };
export const LabelBelowEnd: Story = { args: { labelPlace: "below-end" } };
