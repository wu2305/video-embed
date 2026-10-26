import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { ResultCard } from "./ResultCard";
import { budgetCopyDoc, budgetDoc } from "../../mock/data";

const meta = {
  title: "Molecules/ResultCard",
  component: ResultCard,
  args: { hit: budgetDoc, rank: 1, onOpen: fn() },
  decorators: [(Story) => <div style={{ width: 240 }}><Story /></div>],
} satisfies Meta<typeof ResultCard>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * A NAS document has no thumbnail: the card leads with source and kind. The
 * matched-text slot stays in the component but is left empty here.
 */
export const Document: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvasElement.querySelector(".mm-thumb, img")).toBeNull();
    await expect(canvas.getByText("NAS")).toBeVisible();
    await expect(canvasElement.querySelector(".mm-transcript")).toBeNull();
    await userEvent.click(canvas.getByRole("button", { name: "Q3_budget_review.xlsx" }));
    await expect(args.onOpen).toHaveBeenCalledWith(budgetDoc);
  },
};

/** A backup copy of a file: the folder tells it apart, and it is tagged as a copy. */
export const NonMasterCopy: Story = {
  args: { hit: budgetCopyDoc },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText("copy")).toBeVisible();
    await expect(canvasElement).toHaveTextContent("/nas/backup/finance/");
  },
};

/** The card whose preview is open. */
export const Selected: Story = {
  args: { selected: true },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector(".mm-card")).toHaveClass("selected");
  },
};

/**
 * Ugly data: a 120-character German file name in a deep folder.
 * The name stays one line with an ellipsis, the folder keeps its end, and nothing widens the card.
 */
export const UglyData: Story = {
  args: {
    hit: {
      ...budgetDoc,
      path: "/nas/Archiv/Abteilung Finanzen und Controlling/Konzernabschluss/2025/Konzernbudget_Hotelsparte_Taxiflotte_Abweichungsanalyse_drittes_Quartal_endgültige_Fassung_überarbeitet.xlsx",
    },
  },
  play: async ({ canvasElement }) => {
    const card = canvasElement.querySelector<HTMLElement>(".mm-card")!;
    await expect(card.scrollWidth).toBeLessThanOrEqual(card.clientWidth);
    const name = canvasElement.querySelector<HTMLElement>(".mm-name")!;
    await expect(name.scrollWidth).toBeGreaterThan(name.clientWidth);
  },
};
