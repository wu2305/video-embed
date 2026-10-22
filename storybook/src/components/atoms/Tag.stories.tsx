import type { Meta, StoryObj } from "@storybook/react-vite";
import { Tag } from "./Tag";

const meta = {
  title: "Atoms/Tag",
  component: Tag,
  args: { children: "video" },
  argTypes: { tone: { control: "inline-radio", options: ["neutral", "good", "accent", "warn", "bad"] } },
} satisfies Meta<typeof Tag>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Neutral: Story = {};
export const Good: Story = { args: { tone: "good", children: "00:42–01:11" } };
export const Accent: Story = { args: { tone: "accent", children: "Ana Ruiz" } };
export const Warn: Story = { args: { tone: "warn", children: "copy" } };
export const Bad: Story = { args: { tone: "bad", children: "range" } };

export const AllTones: Story = {
  render: () => (
    <div className="mm-mono">
      {(["neutral", "good", "accent", "warn", "bad"] as const).map((t) => <Tag key={t} tone={t}>{t}</Tag>)}
    </div>
  ),
};
