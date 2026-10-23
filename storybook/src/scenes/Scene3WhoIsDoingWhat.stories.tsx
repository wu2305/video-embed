import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { ResultGrid } from "../components/organisms/ResultGrid";
import { SearchBar, type SearchParams } from "../components/organisms/SearchBar";
import { hits, people } from "../mock/data";

const meta = {
  title: "Scenes/3 · Who is doing what",
  parameters: { docs: { description: { component: "Type a name and an action; results are filtered to that person and ranked by the action." } } },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Flow: Story = {
  render: () => {
    const [query, setQuery] = useState("");
    const [shown, setShown] = useState<typeof hits>([]);
    function search(p: SearchParams) {
      setQuery(p.query);
      setShown(p.parsed.person_ids.length ? hits.filter((h) => p.parsed.person_ids.some((id) => h.person_ids.includes(id))) : hits);
    }
    return (
      <div style={{ display: "grid", gap: 14 }}>
        <SearchBar people={people} initialQuery="Ana is cooking" onSearch={search} />
        <ResultGrid results={shown} people={people} query={query} />
      </div>
    );
  },
};
