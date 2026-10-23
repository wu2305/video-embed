import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import { SearchPage } from "./SearchPage";
import { archiveRecords, audioHit, documentHit, hits, indexInfo, now, people, staleIndexInfo, viewer } from "../mock/data";

const corpus = [...hits, audioHit, documentHit];

const meta = {
  title: "Pages/Search",
  component: SearchPage,
  parameters: { layout: "fullscreen" },
  args: { people, corpus, archive: archiveRecords, index: indexInfo, now, viewer, onNavigate: fn(), onOpenClip: fn() },
} satisfies Meta<typeof SearchPage>;

export default meta;
type Story = StoryObj<typeof meta>;

/** First visit: a search home. The brand, one large field, example queries, and when the index was last updated. */
export const FirstVisit: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { level: 1, name: "Unified Search" })).toBeInTheDocument();
    await expect(canvas.queryByLabelText("limit")).toBeNull();
    // No explanatory paragraph: brand, field, examples and the freshness line only.
    await expect(canvas.queryByText(/allowed to open/)).toBeNull();
    // One example says it finds an Archive record, so the first visit shows both sources.
    await expect(canvas.getByRole("button", { name: "Q3 budget · Archive" })).toBeInTheDocument();
  },
};

/** An example query runs and moves to the results layout, where limit and min faces appear. */
export const ExampleQuery: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Ana is cooking" }));
    await expect(canvas.getByRole("status")).toHaveTextContent(/results for “Ana is cooking”/);
    await expect(canvas.getByLabelText("limit")).toBeInTheDocument();
  },
};

/** Typing on the home shows the who/what readout; submitting moves to the results layout with the query kept. */
export const SearchFromHome: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByRole("searchbox", { name: "Search" }), "Ana and Ben are cooking");
    await expect(canvas.getByText("Ben Okafor")).toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "Search" }));
    await expect(canvas.getByRole("status")).toHaveTextContent(/results for “Ana and Ben are cooking”/);
    await expect(canvas.getByLabelText("query")).toHaveValue("Ana and Ben are cooking");
  },
};

/** A name plus an action: NAS clips with Ana, fused with Archive records about cooking. */
export const Results: Story = { args: { initialQuery: "Ana is cooking" } };

/** Opening a hit previews the matched scene. ← → step through NAS hits only, Esc closes. */
export const PreviewOpen: Story = {
  args: { initialQuery: "Ana is cooking", openId: 101 },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Open clip" }));
    await expect(args.onOpenClip).toHaveBeenCalledWith(expect.objectContaining({ unit_id: 101 }));
  },
};

/** The preview is a modal: it takes focus, keeps Tab inside, and Esc returns focus to the card. */
export const PreviewKeyboard: Story = {
  args: { initialQuery: "Ana is cooking", openId: 101 },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const dialog = canvas.getByRole("dialog");
    await expect(dialog).toHaveAttribute("aria-modal", "true");
    await waitFor(() => expect(dialog).toHaveFocus());
    await expect(canvasElement.querySelector(".mm-shell")).toHaveAttribute("inert");
    for (let i = 0; i < 12; i++) {
      await userEvent.tab();
      await expect(dialog.contains(document.activeElement)).toBe(true);
    }
    await userEvent.keyboard("{Escape}");
    await expect(canvas.queryByRole("dialog")).toBeNull();
    await expect(canvasElement.querySelector(".mm-shell")).not.toHaveAttribute("inert");
    await waitFor(() => expect(canvasElement.querySelector('[data-unit-id="101"] .mm-card-link')).toHaveFocus());
  },
};

/** Video, photo, audio and documents in one list; things without a frame show a glyph. */
export const MixedMedia: Story = { args: { initialQuery: "cooking", archive: [] } };

/** NAS and Archive results fused by rank, with a source filter. */
export const BothSources: Story = {
  args: { initialQuery: "cooking" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("status")).toHaveTextContent(/NAS 6 · Archive 2/);
    await userEvent.click(canvas.getByRole("button", { name: /^Archive \(2\)/ }));
    await expect(canvas.getAllByRole("article")).toHaveLength(2);
  },
};

/** The Archive System timed out: NAS results still show, with a warning. */
export const ArchiveDown: Story = {
  args: { initialQuery: "cooking", archiveDown: true },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole("alert")).toHaveTextContent("The Archive System did not respond");
  },
};

/** The file's permissions changed after last night's update: the preview fails closed. */
export const AccessRevoked: Story = { args: { initialQuery: "Ana is cooking", openId: 101, unavailable: { 101: "forbidden" } } };

/** No nightly update for days: results carry a stale warning. */
export const StaleIndex: Story = { args: { initialQuery: "Ana is cooking", index: staleIndexInfo } };

export const NoHits: Story = { args: { initialQuery: "Ben is skydiving", corpus: [] } };

/** While a search runs, placeholders stand in for results; nothing stale reads as live. */
export const Loading: Story = {
  args: { initialQuery: "Ana is cooking", loading: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("region", { name: "Search results" })).toHaveAttribute("aria-busy", "true");
    await expect(canvas.queryAllByRole("article")).toHaveLength(0);
  },
};

/** A server error says what happened in plain words, offers Try again, and keeps the raw message under Details. */
export const ServerError: Story = {
  args: { initialQuery: "Ana is cooking", error: "ValueError: query vector has 512 dims, index has 768" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("alert")).toHaveTextContent("The search server failed.");
    await expect(canvas.getByRole("status")).not.toHaveTextContent(/ValueError/);
    await userEvent.click(canvas.getByRole("button", { name: "Try again" }));
    await expect(canvas.getByRole("status")).toHaveTextContent(/results for “Ana is cooking”/);
  },
};
