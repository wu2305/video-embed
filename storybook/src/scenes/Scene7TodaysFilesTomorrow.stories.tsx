import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { ResultGrid } from "../components/organisms/ResultGrid";
import { TopBar } from "../components/organisms/TopBar";
import { indexInfo, now, viewer } from "../mock/data";

const meta = {
  title: "Scenes/7 · Today's files, tomorrow morning",
  parameters: {
    layout: "fullscreen",
    docs: { description: { component: "Mei saves a file to the NAS at 10:00 and searches for it at 10:05." } },
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
        <ResultGrid results={[]} query="Q4 room rate sheet" />
      </div>
    </div>
  ),
  play: async ({ canvasElement }) => {
    // No result, and the top bar says when the index last updated.
    await expect(within(canvasElement).getByRole("status")).toHaveTextContent("No results.");
    await expect(within(canvasElement).getByRole("banner")).toHaveTextContent("updated today 02:40");
  },
};
