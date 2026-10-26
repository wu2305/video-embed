import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import { PreviewPanel } from "./PreviewPanel";
import { budgetDoc, documentHits, fareDoc } from "../../mock/data";

const meta = {
  title: "Organisms/PreviewPanel",
  component: PreviewPanel,
  parameters: { layout: "fullscreen" },
  decorators: [(Story) => <div style={{ padding: 20 }}><Story /></div>],
} satisfies Meta<typeof PreviewPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * A NAS document has no frame to show: the panel holds only its details. The
 * matched-text slot stays in the component but is left empty here.
 */
export const Document: Story = {
  args: { hit: budgetDoc, position: 1, total: documentHits.length },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector(".mm-stage, img")).toBeNull();
    await expect(within(canvasElement).getByRole("heading", { name: "Q3_budget_review.xlsx" })).toBeVisible();
    await expect(canvasElement.querySelector(".mm-transcript")).toBeNull();
  },
};

/** ← → step through hits, Esc closes. */
export const Stepping: Story = {
  args: { hit: budgetDoc, position: 1, total: documentHits.length, onClose: fn() },
  render: (args) => {
    const [index, setIndex] = useState(0);
    return (
      <PreviewPanel {...args} hit={documentHits[index]!} position={index + 1}
        onPrev={() => setIndex((i) => Math.max(0, i - 1))}
        onNext={() => setIndex((i) => Math.min(documentHits.length - 1, i + 1))} />
    );
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("dialog"));
    await userEvent.keyboard("{ArrowRight}");
    await waitFor(() => expect(canvas.getByRole("heading", { level: 2 })).toHaveTextContent("group_booking_terms.pdf"));
    await expect(canvasElement).toHaveTextContent("2 / 4");
    await userEvent.keyboard("{ArrowLeft}");
    await expect(canvas.getByRole("heading", { level: 2 })).toHaveTextContent("Q3_budget_review.xlsx");
    await userEvent.keyboard("{Escape}");
    await expect(args.onClose).toHaveBeenCalled();
  },
};

/** The file's permissions changed since last night: it says so, with no text. */
export const AccessRevoked: Story = {
  args: { hit: budgetDoc, position: 1, total: documentHits.length, unavailable: "forbidden" },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole("alert")).toHaveTextContent("You no longer have access to this file.");
    await expect(canvasElement.querySelector(".mm-transcript")).toBeNull();
  },
};

/** The file was deleted or moved on the NAS after the snapshot was published. */
export const FileGone: Story = {
  args: { hit: fareDoc, position: 3, total: documentHits.length, unavailable: "gone" },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole("alert")).toHaveTextContent("This file is no longer on the NAS.");
  },
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
  args: { hit: budgetDoc, position: 1, total: documentHits.length },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    let copied = "";
    await withClipboard(async (text) => { copied = text; }, async () => {
      await userEvent.click(canvas.getByRole("button", { name: "Copy path" }));
      await expect(await canvas.findByText("Path copied")).toBeInTheDocument();
    });
    await expect(copied).toBe(budgetDoc.path);
  },
};

/** When the clipboard is refused, the path appears selected in a field, ready for Ctrl+C. */
export const PathCopyFailed: Story = {
  args: { hit: budgetDoc, position: 1, total: documentHits.length },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await withClipboard(() => Promise.reject(new Error("denied")), async () => {
      await userEvent.click(canvas.getByRole("button", { name: "Copy path" }));
      await expect(await canvas.findByText(/Could not copy/)).toBeInTheDocument();
    });
    const field = canvas.getByLabelText<HTMLInputElement>("File path");
    await expect(field).toHaveValue(budgetDoc.path);
    await expect(field.selectionEnd! - field.selectionStart!).toBe(budgetDoc.path.length);
  },
};
