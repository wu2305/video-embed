import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, userEvent, within } from "storybook/test";
import { ResultGrid } from "./ResultGrid";
import { archiveRecords, documentHits as hits, metricRecords } from "../../mock/data";
import { fuseByRank } from "../../lib/fuse";
import type { Hit } from "../../types";

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

/** The count in the status line takes the text colour; the query is not repeated. Opening a card selects it. */
export const Populated: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const bold = [...canvas.getByRole("status").querySelectorAll("b")].map((b) => b.textContent);
    await expect(bold).toEqual([String(hits.length)]);
    await expect(canvas.getByRole("status")).not.toHaveTextContent("budget");
    await userEvent.click(canvas.getByRole("button", { name: "fare_schedule_2026.pdf" }));
    await expect(canvasElement.querySelector('[data-unit-id="203"]')).toHaveClass("selected");
  },
};

export const NoHits: Story = {
  args: { results: [], query: "fleet insurance" },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole("status")).toHaveTextContent("No results.");
    await expect(within(canvasElement).queryAllByRole("article")).toHaveLength(0);
  },
};

/**
 * 200% zoom on a 640px window leaves 320 CSS pixels: one column, in Chinese, with all three sources and the status line.
 * Nothing scrolls sideways.
 */
export const Zoom200Chinese: Story = {
  args: { results: fuseByRank([hits, archiveRecords.slice(0, 2), metricRecords.slice(0, 1)]), query: "预算" },
  globals: { locale: "zh" },
  decorators: [(Story) => <div style={{ width: 320 }}><Story /></div>],
  play: async ({ canvasElement }) => {
    const box = canvasElement.querySelector<HTMLElement>("section")!;
    await expect(box.scrollWidth).toBeLessThanOrEqual(320);
    await expect(within(box).getByRole("group", { name: "按来源筛选" })).toBeInTheDocument();
  },
};
