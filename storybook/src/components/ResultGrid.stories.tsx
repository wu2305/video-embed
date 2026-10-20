import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { ResultGrid } from "./ResultGrid";
import { hits, people } from "../mock/data";
import type { Hit } from "../types";

const meta = {
  title: "Scene 3 · Who is doing what/ResultGrid",
  component: ResultGrid,
  args: { hits, people, query: "Ana Ruiz is cooking" },
  render: (args) => {
    const [selected, setSelected] = useState<number | null>(args.selectedId ?? null);
    return <ResultGrid {...args} selectedId={selected} onOpen={(h: Hit) => setSelected(h.unit_id)} />;
  },
} satisfies Meta<typeof ResultGrid>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Populated: Story = {};
export const Loading: Story = { args: { loading: true, hits: [] } };
export const NoHits: Story = { args: { hits: [], query: "Ana Ruiz is skydiving" } };
export const ServerError: Story = { args: { hits: [], error: "ValueError: query vector has 512 dims, index has 768" } };
