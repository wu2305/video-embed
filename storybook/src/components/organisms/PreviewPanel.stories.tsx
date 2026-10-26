import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, userEvent, within } from "storybook/test";
import { PreviewPanel } from "./PreviewPanel";
import { annotations, cookingHit, documentHit, duration, hitFaces, hits, kitchenFaces, kitchenFrame, people, photoHit, presentingHit, scenes } from "../../mock/data";
import type { Hit } from "../../types";

const meta = {
  title: "Organisms/PreviewPanel",
  component: PreviewPanel,
  parameters: { layout: "fullscreen" },
  decorators: [(Story) => <div style={{ padding: 20 }}><Story /></div>],
} satisfies Meta<typeof PreviewPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Arrow keys step through hits, Esc closes. Poster frames stand in for the video. */
export const Stepping: Story = {
  args: { hit: cookingHit, position: 1, total: hits.length, frameSrc: kitchenFrame },
  render: () => {
    const [index, setIndex] = useState(0);
    const [playhead, setPlayhead] = useState(44);
    const hit: Hit = hits[index]!;
    return (
      <PreviewPanel
        hit={hit}
        position={index + 1}
        total={hits.length}
        frameSrc={hit.thumb_url ?? kitchenFrame}
        faces={hitFaces(hit)}
        people={people}
        annotations={annotations}
        scenes={scenes}
        duration={duration}
        playhead={playhead}
        onSeek={setPlayhead}
        onPrev={() => setIndex((i) => Math.max(0, i - 1))}
        onNext={() => setIndex((i) => Math.min(hits.length - 1, i + 1))}
      />
    );
  },
};

/** The note under the playhead is drawn over the frame. */
export const WithNoteOverlay: Story = {
  args: {
    hit: cookingHit, position: 1, total: 4, frameSrc: kitchenFrame, faces: kitchenFaces,
    people, annotations, scenes, duration, playhead: 50,
  },
};

/** An image has no timeline and no seek. */
export const Image: Story = {
  args: { hit: photoHit, position: 3, total: 4, frameSrc: photoHit.thumb_url!, people, faces: hitFaces(photoHit) },
};

/**
 * A NAS document has no frame to show: the panel holds only its details. The
 * matched-text slot stays in the component but is left empty here.
 */
export const Document: Story = {
  args: { hit: { ...documentHit, ocr_text: "", asr_text: "" }, position: 2, total: 4 },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector(".mm-stage, img")).toBeNull();
    await expect(within(canvasElement).getByRole("heading", { name: "recipe_notes.pdf" })).toBeVisible();
  },
};

/** A document whose access was revoked says so under its name, with no text. */
export const DocumentAccessRevoked: Story = {
  args: { hit: { ...documentHit, ocr_text: "", asr_text: "" }, position: 2, total: 4, unavailable: "forbidden" },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole("alert")).toBeInTheDocument();
    await expect(canvasElement.querySelector(".mm-transcript")).toBeNull();
  },
};

/** The file's permissions changed since last night: no frame, no text, no Open clip. */
export const AccessRevoked: Story = {
  args: { hit: cookingHit, position: 1, total: 4, frameSrc: kitchenFrame, people, unavailable: "forbidden" },
};

/** The file was deleted or moved on the NAS after the snapshot was published. */
export const FileGone: Story = {
  args: { hit: presentingHit, position: 2, total: 4, frameSrc: kitchenFrame, people, unavailable: "gone" },
};

/** Swaps navigator.clipboard for the length of a play function. */
async function withClipboard(writeText: (text: string) => Promise<void>, run: () => Promise<void>) {
  const original = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  try { await run(); } finally {
    if (original) Object.defineProperty(navigator, "clipboard", original);
    else delete (navigator as { clipboard?: unknown }).clipboard;
  }
}

/** Copy path confirms the copy. */
export const PathCopied: Story = {
  args: { hit: cookingHit, position: 1, total: hits.length, frameSrc: kitchenFrame },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    let copied = "";
    await withClipboard(async (text) => { copied = text; }, async () => {
      await userEvent.click(canvas.getByRole("button", { name: "Copy path" }));
      await expect(await canvas.findByText("Path copied")).toBeInTheDocument();
    });
    await expect(copied).toBe(cookingHit.path);
  },
};

/** When the clipboard is refused, the path appears selected in a field, ready for Ctrl+C. */
export const PathCopyFailed: Story = {
  args: { hit: cookingHit, position: 1, total: hits.length, frameSrc: kitchenFrame },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await withClipboard(() => Promise.reject(new Error("denied")), async () => {
      await userEvent.click(canvas.getByRole("button", { name: "Copy path" }));
      await expect(await canvas.findByText(/Could not copy/)).toBeInTheDocument();
    });
    const field = canvas.getByLabelText<HTMLInputElement>("File path");
    await expect(field).toHaveValue(cookingHit.path);
    await expect(field.selectionEnd! - field.selectionStart!).toBe(cookingHit.path.length);
  },
};
