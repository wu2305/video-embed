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

/** Three reports listed, the rest counted. The name opens the preview; each report opens in BI. */
export const ManyReports: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getAllByRole("listitem")).toHaveLength(3);
    await expect(canvas.getByRole("link", { name: "Regional sales dashboard" })).toHaveAttribute("href", "https://bi.example.internal/reports/R-0981");
    await expect(canvasElement).toHaveTextContent("+4 more");
    await userEvent.click(canvas.getByRole("button", { name: "Net revenue" }));
    await expect(args.onOpen).toHaveBeenCalledWith(expect.objectContaining({ metric_id: "fin.net_revenue" }));
  },
};

export const OneReport: Story = {
  args: { metric: metricRecords[2]! },
  play: async ({ canvasElement }) => {
    await expect(canvasElement).toHaveTextContent("Used in 1 report");
    await expect(within(canvasElement).queryByText(/more/)).toBeNull();
  },
};

/** The metric exists but nothing uses it. */
export const NoReports: Story = {
  args: { metric: metricRecords[3]! },
  play: async ({ canvasElement }) => {
    await expect(canvasElement).toHaveTextContent("No reports use it.");
    await expect(within(canvasElement).queryByRole("list")).toBeNull();
  },
};

export const Chinese: Story = {
  globals: { locale: "zh" },
  play: async ({ canvasElement }) => {
    await expect(canvasElement).toHaveTextContent("被 7 个报表使用");
  },
};
