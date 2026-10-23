import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { Panel } from "../components/atoms/Panel";
import { ResultGrid } from "../components/organisms/ResultGrid";
import { fuseByRank } from "../lib/fuse";
import { archiveRecords, cookingHit, copyHit, people, photoHit, presentingHit, viewer } from "../mock/data";
import type { Viewer } from "../types";

const meta = {
  title: "Scenes/6 · Only what you may open",
  parameters: {
    layout: "fullscreen",
    docs: { description: { component: "Mei and Raj run the same query and each sees only what they may open." } },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const raj: Viewer = { name: "Raj Patel", groups: ["Finance"] };

/** Same query, two users. Marketing footage is not in Raj's list; the Finance minutes are not in Mei's. */
export const TwoUsers: Story = {
  render: () => (
    <div className="mm-split" style={{ padding: 20, gridTemplateColumns: "1fr 1fr" }}>
      {[
        { who: viewer, results: fuseByRank([[cookingHit, copyHit, photoHit], archiveRecords.slice(0, 1)]) },
        { who: raj, results: fuseByRank([[presentingHit], archiveRecords.slice(1, 2)]) },
      ].map(({ who, results }) => (
        <Panel key={who.name} title={`${who.name} · ${who.groups.join(", ")}`}>
          <ResultGrid results={results} people={people} query="cooking or budget" label={`Results for ${who.name}`} />
        </Panel>
      ))}
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Same query, different results: each viewer sees only what they may open.
    const grids = canvas.getAllByRole("region", { name: /^Results for / });
    await expect(grids).toHaveLength(2);
    await expect(grids[0]!.textContent).not.toBe(grids[1]!.textContent);
  },
};
