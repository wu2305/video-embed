import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { Label } from "./Label";

const meta = { title: "Atoms/Label", component: Label, args: { children: "type" } } satisfies Meta<typeof Label>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector("label.mm-label")).toHaveTextContent("type");
  },
};
/** A heading for a group of controls: a span, not a label. */
export const GroupHeading: Story = {
  args: { as: "span", children: "reports" },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector("span.mm-label")).toHaveTextContent("reports");
    await expect(canvasElement.querySelector("label")).toBeNull();
  },
};
