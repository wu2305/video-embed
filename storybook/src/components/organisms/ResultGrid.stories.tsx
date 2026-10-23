import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, within } from "storybook/test";
import { ResultGrid } from "./ResultGrid";
import { archiveRecords, hits, people } from "../../mock/data";
import { fuseByRank } from "../../lib/fuse";
import type { Hit, SourceStatus } from "../../types";

const meta = {
  title: "Organisms/ResultGrid",
  component: ResultGrid,
  args: { results: hits, people, query: "Ana Ruiz is cooking" },
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

/** The count and the query in the status line take the text colour; the rest stays muted. */
export const Populated: Story = {
  play: async ({ canvasElement }) => {
    const bold = [...within(canvasElement).getByRole("status").querySelectorAll("b")].map((b) => b.textContent);
    await expect(bold).toEqual([String(hits.length), "Ana Ruiz is cooking"]);
  },
};
/** NAS and Archive results fused by rank; source badges and a source filter appear. */
export const BothSources: Story = { args: { results: fuseByRank([hits, archiveRecords.slice(0, 2)]), query: "cooking" } };
/** One source failed: show what the other returned, and say the list is incomplete. */
export const SourceDown: Story = { args: { sources: archiveDown, query: "cooking" } };
export const Loading: Story = { args: { loading: true, results: [] } };
export const NoHits: Story = { args: { results: [], query: "Ana Ruiz is skydiving" } };
/**
 * 200% zoom on a 640px window leaves 320 CSS pixels: one column, in Chinese, with both sources and the status line.
 * Nothing scrolls sideways.
 */
export const Zoom200Chinese: Story = {
  args: { results: fuseByRank([hits, archiveRecords.slice(0, 2)]), query: "做饭" },
  globals: { locale: "zh" },
  decorators: [(Story) => <div style={{ width: 320 }}><Story /></div>],
  play: async ({ canvasElement }) => {
    const box = canvasElement.querySelector<HTMLElement>("section")!;
    await expect(box.scrollWidth).toBeLessThanOrEqual(320);
  },
};

export const ServerError: Story = { args: { results: [], error: "ValueError: query vector has 512 dims, index has 768" } };
