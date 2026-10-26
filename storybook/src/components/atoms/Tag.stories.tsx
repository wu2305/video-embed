import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { Tag } from "./Tag";

const meta = {
  title: "Atoms/Tag",
  component: Tag,
  args: { children: "document" },
  argTypes: { tone: { control: "inline-radio", options: ["neutral", "good", "accent", "warn", "bad"] } },
} satisfies Meta<typeof Tag>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Neutral: Story = {
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector(".mm-tag")).toHaveTextContent("document");
  },
};

export const AllTones: Story = {
  render: () => (
    <div className="mm-mono">
      {(["neutral", "good", "accent", "warn", "bad"] as const).map((t) => <Tag key={t} tone={t}>{t}</Tag>)}
    </div>
  ),
  play: async ({ canvasElement }) => {
    await expect([...canvasElement.querySelectorAll(".mm-tag")].map((t) => t.className)).toEqual(
      ["mm-tag", "mm-tag good", "mm-tag accent", "mm-tag warn", "mm-tag bad"]);
  },
};
