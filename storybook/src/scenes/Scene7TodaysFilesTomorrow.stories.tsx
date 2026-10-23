import type { Meta, StoryObj } from "@storybook/react-vite";
import { ResultGrid } from "../components/organisms/ResultGrid";
import { TopBar } from "../components/organisms/TopBar";
import { indexInfo, now, people, viewer } from "../mock/data";

const meta = {
  title: "Scenes/7 · Today's files, tomorrow morning",
  parameters: {
    layout: "fullscreen",
    docs: { description: { component: "Mei uploads footage at 10:00 and searches for it at 10:05." } },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** A fresh upload is not found yet; the top bar says when the index last updated. */
export const NotYetIndexed: Story = {
  render: () => (
    <div>
      <TopBar current="search" index={indexInfo} now={now} viewer={viewer} />
      <div style={{ padding: 20, display: "grid", gap: 14 }}>
        <ResultGrid results={[]} people={people} query="launch event rehearsal" />
      </div>
    </div>
  ),
};
