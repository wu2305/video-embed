import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { MetricCard } from "./MetricCard";
import { metricRecords } from "../../mock/data";

const meta = {
  title: "Molecules/MetricCard",
  component: MetricCard,
  args: { metric: metricRecords[0]!, rank: 1, onOpen: fn() },
  decorators: [(Story) => <div style={{ width: 240 }}><Story /></div>],
} satisfies Meta<typeof MetricCard>;

export default meta;
type Story = StoryObj<typeof meta>;

/** No reports on the card; the name opens the preview, which lists them. */
export const Metric: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryAllByRole("listitem")).toHaveLength(0);
    await expect(canvas.queryAllByRole("link")).toHaveLength(0);
    await userEvent.click(canvas.getByRole("button", { name: "RevPAR" }));
    await expect(args.onOpen).toHaveBeenCalledWith(expect.objectContaining({ metric_id: "hotel.revpar" }));
  },
};
