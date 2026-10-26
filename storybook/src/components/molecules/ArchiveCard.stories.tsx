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

/** The vendor may return no summary; the card still has type, date and id. */
export const NoSummary: Story = {
  args: { record: archiveRecords[2]!, rank: 5 },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole("article", { name: "Result 5" })).toHaveTextContent("Purchase order");
    await expect(canvasElement.querySelectorAll(".mm-text")).toHaveLength(0);
  },
};
