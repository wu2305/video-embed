import type { Meta, StoryObj } from "@storybook/react-vite";
import { Tag } from "./Tag";

const meta = {
  title: "Atoms/Tag",
  component: Tag,
  args: { children: "document" },
  argTypes: { tone: { control: "inline-radio", options: ["neutral", "good", "accent", "warn", "bad"] } },
} satisfies Meta<typeof Tag>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Neutral: Story = {};

export const AllTones: Story = {
  render: () => (
    <div className="mm-mono">
      {(["neutral", "good", "accent", "warn", "bad"] as const).map((t) => <Tag key={t} tone={t}>{t}</Tag>)}
    </div>
  ),
};
