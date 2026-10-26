import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import { MetricPreview, REPORTS_PAGE, type ReportsRequest } from "./MetricPreview";
import { metricRecords, metricReports } from "../../mock/data";
import { queryReports } from "../../pages/search";
import type { MetricRecord, MetricReport } from "../../types";

const revpar = metricRecords[0]!;

/** A metric used across the group: enough reports for four pages. */
const occupancyReports: MetricReport[] = Array.from({ length: 34 }, (_, i) => ({
  report_id: `R-${2000 + i}`, title: `Hotel ${String.fromCharCode(65 + (i % 26))}${i >= 26 ? 2 : ""} daily occupancy`,
  kind: i % 4 === 0 ? "dashboard" : "report", folder: i % 3 === 0 ? "Finance / Close" : "Hotels / Operations",
  owner: i % 2 ? "Mei Chen" : "Sam Okoye", charts: 1 + (i % 3), updated_at: 1792500000 - i * 86400,
  deep_link: `https://bi.example.internal/reports/R-${2000 + i}`,
}));
const occupancy: MetricRecord = {
  source: "bi", metric_id: "hotel.occupancy", name: "Occupancy rate", domain: "Hotels", owner: "Lena Vogt",
  definition: "Occupied room nights ÷ available room nights", reports: occupancyReports.slice(0, 3),
  report_count: occupancyReports.length, deep_link: "https://bi.example.internal/metrics/hotel.occupancy", vendor_rank: 1,
};

/**
 * `reports` here is every report the endpoint holds; the story answers each
 * request with one page of it, as the gateway would.
 */
const meta = {
  title: "Organisms/MetricPreview",
  component: MetricPreview,
  args: { metric: revpar, reports: metricReports[revpar.metric_id], onClose: fn(), onRetry: fn(), onRequest: fn() },
  render: (args) => {
    const [ask, setAsk] = useState<ReportsRequest>({ q: "", offset: 0, limit: REPORTS_PAGE });
    const page = args.reports ? queryReports(args.reports, ask) : null;
    return <MetricPreview {...args} reports={page?.reports ?? null} total={page?.total} offset={ask.offset}
      onRequest={(r) => { setAsk(r); args.onRequest?.(r); }} />;
  },
} satisfies Meta<typeof MetricPreview>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Every report that uses the metric, with type, folder, owner, charts and date. */
export const AllReports: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getAllByRole("listitem")).toHaveLength(7);
    await expect(canvas.getAllByRole("listitem")[2]).toHaveTextContent("dashboard · Hotels / Revenue · Lena Vogt · 3 charts · 2026-10-21");
    // One page holds them all: no pager.
    await expect(canvas.queryByRole("navigation")).toBeNull();
    await userEvent.type(canvas.getByRole("searchbox", { name: "Filter reports" }), "zzz");
    await expect(await canvas.findByText("No reports match.")).toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: /Close/ }));
    await expect(args.onClose).toHaveBeenCalled();
  },
};

/**
 * More reports than one page: the server sends ten at a time and the pager
 * walks them. Previous and Next stay focusable at the ends. A filter starts
 * again from the first page.
 */
export const ManyReports: Story = {
  args: { metric: occupancy, reports: occupancyReports },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const pager = within(canvas.getByRole("navigation", { name: "Report pages" }));
    await expect(canvas.getAllByRole("listitem")).toHaveLength(10);
    await expect(pager.getByText("1–10 of 34")).toBeInTheDocument();
    await expect(pager.getByRole("button", { name: "Previous" })).toHaveAttribute("aria-disabled", "true");
    for (let i = 0; i < 3; i++) await userEvent.click(pager.getByRole("button", { name: "Next" }));
    await expect(pager.getByText("31–34 of 34")).toBeInTheDocument();
    await expect(canvas.getAllByRole("listitem")).toHaveLength(4);
    await expect(pager.getByRole("button", { name: "Next" })).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(pager.getByRole("button", { name: "Next" }));
    await expect(args.onRequest).toHaveBeenCalledTimes(3);
    await userEvent.type(canvas.getByRole("searchbox", { name: "Filter reports" }), "mei");
    await waitFor(() => expect(args.onRequest).toHaveBeenLastCalledWith({ q: "mei", offset: 0, limit: 10 }));
    await expect(within(canvas.getByRole("navigation")).getByText("1–10 of 17")).toBeInTheDocument();
  },
};

/** The same pager in Chinese at 320px: the range sits between the buttons, nothing scrolls sideways. */
export const ManyReportsPhone320Chinese: Story = {
  args: { metric: occupancy, reports: occupancyReports },
  globals: { locale: "zh" },
  decorators: [(Story) => <div style={{ width: 320 }}><Story /></div>],
  play: async ({ canvasElement }) => {
    const box = canvasElement.querySelector<HTMLElement>(".mm-metric-preview")!;
    await expect(box.scrollWidth).toBeLessThanOrEqual(320);
    const pager = within(within(box).getByRole("navigation", { name: "报表分页" }));
    await expect(pager.getByText("第 1–10 条，共 34 条")).toBeInTheDocument();
    await expect(pager.getByRole("button", { name: "下一页" })).toBeInTheDocument();
  },
};

/** Two reports: no filter field. */
export const FewReports: Story = {
  args: { metric: metricRecords[1]!, reports: metricReports["taxi.revenue_per_trip"] },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByRole("searchbox")).toBeNull();
  },
};

export const ReportsFailed: Story = {
  args: { reports: undefined, error: true },
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: "Try again" }));
    await expect(args.onRetry).toHaveBeenCalled();
  },
};

/** 320px wide, in Chinese: the rows wrap and nothing scrolls sideways. */
export const Phone320Chinese: Story = {
  globals: { locale: "zh" },
  decorators: [(Story) => <div style={{ width: 320 }}><Story /></div>],
  play: async ({ canvasElement }) => {
    const box = canvasElement.querySelector<HTMLElement>(".mm-metric-preview")!;
    await expect(box.scrollWidth).toBeLessThanOrEqual(320);
    await expect(within(box).getByRole("heading", { level: 3 })).toHaveTextContent("报表");
  },
};
