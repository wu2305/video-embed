import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor } from "storybook/test";
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

/** A phone-width stage: labels are measured as rendered, so no label covers another label or a face. */
export const NarrowStage: Story = {
  render: (args) => (
    <div className="mm-stage" style={{ width: 288 }}>
      <img src={kitchenFrame} alt="Kitchen keyframe" />
      <FaceOverlay {...args} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const rect = (el: Element) => el.getBoundingClientRect();
    const hit = (a: DOMRect, b: DOMRect) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    await waitFor(() => {
      const labels = [...canvasElement.querySelectorAll(".mm-face-label")].map(rect);
      const faces = [...canvasElement.querySelectorAll("[data-face]")];
      labels.forEach((label, i) => {
        labels.forEach((other, j) => { if (i !== j) expect(hit(label, other)).toBe(false); });
        faces.forEach((face, j) => { if (i !== j) expect(hit(label, rect(face))).toBe(false); });
      });
    });
  },
};
