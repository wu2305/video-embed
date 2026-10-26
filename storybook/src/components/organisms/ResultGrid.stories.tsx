import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, within } from "storybook/test";
import { ResultGrid } from "./ResultGrid";
import { archiveRecords, documentHits as hits, metricRecords } from "../../mock/data";
import { fuseByRank } from "../../lib/fuse";
import type { Hit, SourceStatus } from "../../types";

const meta = {
  title: "Organisms/ResultGrid",
  component: ResultGrid,
  args: { results: hits, query: "budget" },
  render: (args) => {
    const [selected, setSelected] = useState<number | null>(args.selectedId ?? null);
    return <ResultGrid {...args} selectedId={selected} onOpen={(h: Hit) => setSelected(h.unit_id)} />;
  },
} satisfies Meta<typeof ResultGrid>;

export default meta;
type Story = StoryObj<typeof meta>;

const archiveDown: SourceStatus[] = [
  { source: "nas", state: "ok", count: hits.length },
  { source: "archive", state: "unavailable", count: 0 },
];

/** The count in the status line takes the text colour; the query is not repeated. */
export const Populated: Story = {
  play: async ({ canvasElement }) => {
    const bold = [...within(canvasElement).getByRole("status").querySelectorAll("b")].map((b) => b.textContent);
    await expect(bold).toEqual([String(hits.length)]);
  },
};
/** NAS and Archive results fused by rank; source badges and a source filter appear. */
export const BothSources: Story = { args: { results: fuseByRank([hits, archiveRecords.slice(0, 2)]), query: "budget" } };
/** BI metrics with the reports that use them, fused with NAS hits and Archive records. */
export const WithMetrics: Story = { args: { results: fuseByRank([hits, archiveRecords.slice(0, 1), metricRecords.slice(0, 2)]), query: "revenue" } };
/** One source failed: show what the other returned, and say the list is incomplete. */
export const SourceDown: Story = { args: { sources: archiveDown, query: "budget" } };
export const Loading: Story = { args: { loading: true, results: [] } };
export const NoHits: Story = { args: { results: [], query: "fleet insurance" } };
/**
 * 200% zoom on a 640px window leaves 320 CSS pixels: one column, in Chinese, with both sources and the status line.
 * Nothing scrolls sideways.
 */
export const Zoom200Chinese: Story = {
  args: { results: fuseByRank([hits, archiveRecords.slice(0, 2), metricRecords.slice(0, 1)]), query: "预算" },
  globals: { locale: "zh" },
  decorators: [(Story) => <div style={{ width: 320 }}><Story /></div>],
  play: async ({ canvasElement }) => {
    const box = canvasElement.querySelector<HTMLElement>("section")!;
    await expect(box.scrollWidth).toBeLessThanOrEqual(320);
  },
};

export const ServerError: Story = { args: { results: [], error: "ValueError: query vector has 512 dims, index has 768" } };
