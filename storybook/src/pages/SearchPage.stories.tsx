import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
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

/** First visit: examples, what each source covers, and when today's files show up. */
export const FirstVisit: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/Live documents are not searched here/)).toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "Ana is cooking" }));
    await expect(canvas.getByRole("status")).toHaveTextContent(/results for “Ana is cooking”/);
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

/** Keyboard: Enter on a card opens, focus moves inside, Tab stays inside, Esc closes and focus returns. */
export const PreviewKeyboard: Story = {
  args: { initialQuery: "Ana is cooking" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const opener = canvas.getByRole("button", { name: "cooking_class_03.mp4" });
    opener.focus();
    await userEvent.keyboard("{Enter}");
    const dialog = await canvas.findByRole("dialog");
    await expect(dialog).toHaveAttribute("aria-modal", "true");
    await expect(dialog.contains(document.activeElement)).toBe(true);
    await expect(document.body.style.overflow).toBe("hidden");
    await userEvent.tab();
    await expect(dialog.contains(document.activeElement)).toBe(true);
    await userEvent.tab({ shift: true });
    await expect(dialog.contains(document.activeElement)).toBe(true);
    await userEvent.keyboard("{Escape}");
    await expect(canvas.queryByRole("dialog")).not.toBeInTheDocument();
    await expect(document.activeElement).toBe(opener);
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

export const Loading: Story = { args: { initialQuery: "Ana is cooking", loading: true } };

export const ServerError: Story = {
  args: { initialQuery: "Ana is cooking", error: "ValueError: query vector has 512 dims, index has 768" },
};
