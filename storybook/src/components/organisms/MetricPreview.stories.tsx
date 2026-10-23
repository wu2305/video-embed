import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { MetricPreview } from "./MetricPreview";
import { metricRecords, metricReports } from "../../mock/data";

const revenue = metricRecords[0]!;

const meta = {
  title: "Organisms/MetricPreview",
  component: MetricPreview,
  args: { metric: revenue, reports: metricReports[revenue.metric_id], onClose: fn(), onRetry: fn() },
} satisfies Meta<typeof MetricPreview>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Every report that uses the metric, with type, folder, owner, charts and date. */
export const AllReports: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getAllByRole("listitem")).toHaveLength(7);
    await expect(canvas.getAllByRole("listitem")[2]).toHaveTextContent("dashboard · Sales · Lena Vogt · 3 charts · 2026-10-21");
    await userEvent.type(canvas.getByRole("searchbox", { name: "Filter reports" }), "zzz");
    await expect(canvas.getByText("No reports match.")).toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: /Close/ }));
    await expect(args.onClose).toHaveBeenCalled();
  },
};

/** Two reports: no filter field. */
export const FewReports: Story = {
  args: { metric: metricRecords[1]!, reports: metricReports["fin.arpu"] },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByRole("searchbox")).toBeNull();
  },
};

export const Loading: Story = { args: { reports: null } };

export const ReportsFailed: Story = {
  args: { reports: null, error: true },
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: "Try again" }));
    await expect(args.onRetry).toHaveBeenCalled();
  },
};

export const NoReports: Story = { args: { metric: metricRecords[3]!, reports: [] } };

/** 320px wide, in Chinese: the rows wrap and nothing scrolls sideways. */
export const Phone320Chinese: Story = {
  globals: { locale: "zh" },
  decorators: [(Story) => <div style={{ width: 320 }}><Story /></div>],
  play: async ({ canvasElement }) => {
    const box = canvasElement.querySelector<HTMLElement>(".mm-metric-preview")!;
    await expect(box.scrollWidth).toBeLessThanOrEqual(320);
    await expect(box).toHaveTextContent("被 7 个报表使用");
  },
};
