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

/** Three reports listed, the rest counted. The name and "+4 more" open the preview; each report opens in BI. */
export const ManyReports: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getAllByRole("listitem")).toHaveLength(3);
    await expect(canvas.getByRole("link", { name: "Hotel portfolio dashboard" })).toHaveAttribute("href", "https://bi.example.internal/reports/R-0981");
    await expect(canvasElement).toHaveTextContent("+4 more");
    await userEvent.click(canvas.getByRole("button", { name: "RevPAR" }));
    await expect(args.onOpen).toHaveBeenCalledWith(expect.objectContaining({ metric_id: "hotel.revpar" }));
    await userEvent.click(canvas.getByRole("button", { name: "+4 more" }));
    await expect(args.onOpen).toHaveBeenCalledTimes(2);
  },
};

export const OneReport: Story = {
  args: { metric: metricRecords[2]! },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getAllByRole("listitem")).toHaveLength(1);
    await expect(within(canvasElement).queryByText(/more/)).toBeNull();
    await expect(within(canvasElement).getAllByRole("button")).toHaveLength(1);
  },
};

