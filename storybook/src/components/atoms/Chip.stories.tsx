import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { Chip } from "./Chip";

const meta = { title: "Atoms/Chip", component: Chip, args: { children: "Archive" } } satisfies Meta<typeof Chip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Off: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole("button", { name: "Archive" })).toHaveAttribute("aria-pressed", "false");
  },
};
/** On is a fill and a heavier label as well as a colour, so it reads in grayscale. */
export const On: Story = {
  args: { pressed: true },
  play: async ({ canvasElement }) => {
    const chip = within(canvasElement).getByRole("button");
    await expect(getComputedStyle(chip).fontWeight).toBe("600");
  },
};
