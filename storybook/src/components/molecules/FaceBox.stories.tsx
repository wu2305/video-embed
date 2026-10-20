import type { Meta, StoryObj } from "@storybook/react-vite";
import { FaceBox } from "./FaceBox";
import { kitchenFrame } from "../../mock/data";

const meta = {
  title: "Molecules/FaceBox",
  component: FaceBox,
  args: { face: { face_index: 0, bbox: [0.3, 0.2, 0.25, 0.35], person_id: "person-0003" }, label: "Ana Ruiz" },
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
export const Untagged: Story = { args: { face: { face_index: 1, bbox: [0.3, 0.2, 0.25, 0.35], person_id: null }, label: "untagged" } };
export const Selected: Story = { args: { selected: true, onSelect: () => {} } };
