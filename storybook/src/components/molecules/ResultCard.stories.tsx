import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, waitFor, within } from "storybook/test";
import { ResultCard } from "./ResultCard";
import { copyHit, cookingHit, documentHit, people, photoHit, presentingHit } from "../../mock/data";

const meta = {
  title: "Molecules/ResultCard",
  component: ResultCard,
  args: { hit: cookingHit, rank: 1, people, onOpen: fn() },
  decorators: [(Story) => <div style={{ width: 240 }}><Story /></div>],
} satisfies Meta<typeof ResultCard>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Named people, a note (blue) and ASR text (yellow). */
export const Named: Story = {};

/** Without names the card shows cluster ids, as the console does today. */
export const Anonymous: Story = { args: { hit: presentingHit, people: [] } };

export const Image: Story = { args: { hit: photoHit } };

/** A NAS document has no thumbnail: the card leads with source and kind, then the OCR text. */
export const Document: Story = {
  args: { hit: documentHit, rank: 3 },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector(".mm-thumb, img")).toBeNull();
    await expect(within(canvasElement).getByText("NAS")).toBeVisible();
  },
};

export const NonMasterCopy: Story = { args: { hit: copyHit } };

export const Selected: Story = { args: { selected: true } };

/**
 * Ugly data: a 120-character German file name in a deep folder, 40 faces and a thumbnail that fails to load.
 * The name stays one line with an ellipsis, the folder keeps its end, the tags wrap, and nothing widens the card.
 */
export const UglyData: Story = {
  args: {
    hit: {
      ...cookingHit,
      path: "/media/Archiv/Abteilung Öffentlichkeitsarbeit/Veranstaltungen/2025/Jahresabschlussfeier_Großküche_Mitarbeiterversammlung_Kochvorführung_Teil_03_endgültige_Fassung_überarbeitet.mp4",
      face_count: 40,
      thumb_url: "/missing-thumb.webp",
    },
  },
  play: async ({ canvasElement }) => {
    const card = canvasElement.querySelector<HTMLElement>(".mm-card")!;
    await expect(card.scrollWidth).toBeLessThanOrEqual(card.clientWidth);
    await waitFor(() => expect(canvasElement.querySelector(".mm-glyph")).not.toBeNull());
  },
};

/** For "appears in" lists: no rank, score or machine text. */
export const Compact: Story = { args: { compact: true } };
