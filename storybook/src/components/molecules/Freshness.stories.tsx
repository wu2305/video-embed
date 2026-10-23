import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { Freshness } from "./Freshness";
import { indexInfo, now, staleIndexInfo } from "../../mock/data";

const meta = {
  title: "Molecules/Freshness",
  component: Freshness,
  args: { index: indexInfo, now },
} satisfies Meta<typeof Freshness>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Top bar: item count and when last night's cycle published. */
export const Short: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText(/updated today 02:40/)).toBeInTheDocument();
  },
};

/** The long form, as a full sentence. */
export const Long: Story = { args: { long: true } };

/** Nothing published for longer than the nightly cadence. */
export const Stale: Story = { args: { index: staleIndexInfo, long: true } };

