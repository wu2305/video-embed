import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { ArchiveCard } from "./ArchiveCard";
import { archiveRecords } from "../../mock/data";

const meta = {
  title: "Molecules/ArchiveCard",
  component: ArchiveCard,
  args: { record: archiveRecords[0]!, rank: 2 },
  decorators: [(Story) => <div style={{ width: 240 }}><Story /></div>],
} satisfies Meta<typeof ArchiveCard>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The title opens the record in the Archive System, in a new tab. */
export const Contract: Story = {
  play: async ({ canvasElement }) => {
    const link = within(canvasElement).getByRole("link");
    await expect(link).toHaveAttribute("href", "https://archive.example.internal/records/CT-2025-0412");
    await expect(link).toHaveAttribute("target", "_blank");
  },
};

/** Only the fields every vendor returns: type, title and date. Department and summary stay off the card. */
export const FieldsEveryVendorReturns: Story = {
  play: async ({ canvasElement }) => {
    const card = within(canvasElement).getByRole("article", { name: "Result 2" });
    await expect(card).toHaveTextContent("Contract");
    await expect(card.querySelectorAll(".mm-tag")).toHaveLength(1);
    await expect(card.querySelectorAll(".mm-text")).toHaveLength(0);
  },
};
