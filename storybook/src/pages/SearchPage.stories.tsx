import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { SearchPage } from "./SearchPage";
import { audioHit, documentHit, externalHit, hits, indexInfo, people } from "../mock/data";

const corpus = [...hits, audioHit, documentHit];

const meta = {
  title: "Pages/Search",
  component: SearchPage,
  parameters: { layout: "fullscreen" },
  args: { people, corpus, units: indexInfo.units, snapshot: indexInfo.snapshot, onNavigate: fn(), onOpenClip: fn() },
} satisfies Meta<typeof SearchPage>;

export default meta;
type Story = StoryObj<typeof meta>;

/** First visit: no query yet, so the page offers examples instead of an empty grid. */
export const FirstVisit: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Ana is cooking" }));
    await expect(canvas.getByRole("status")).toHaveTextContent(/hits for “Ana is cooking”/);
  },
};

/** A name plus an action: only clips with Ana, ranked by what is on screen. */
export const Results: Story = { args: { initialQuery: "Ana is cooking" } };

/** Opening a hit previews the matched scene. ← → step through hits, Esc closes. */
export const PreviewOpen: Story = {
  args: { initialQuery: "Ana is cooking", openId: 101 },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Open clip" }));
    await expect(args.onOpenClip).toHaveBeenCalledWith(expect.objectContaining({ unit_id: 101 }));
  },
};

/** Video, photo, audio and documents in one list; things without a frame show a glyph. */
export const MixedMedia: Story = { args: { initialQuery: "cooking" } };

/** Another search API merged in, marked with its source. */
export const FederatedSources: Story = { args: { corpus: [externalHit, ...corpus], initialQuery: "cooking" } };

export const NoHits: Story = { args: { initialQuery: "Ben is skydiving", corpus: [] } };

export const Loading: Story = { args: { initialQuery: "Ana is cooking", loading: true } };

export const ServerError: Story = {
  args: { initialQuery: "Ana is cooking", error: "ValueError: query vector has 512 dims, index has 768" },
};
