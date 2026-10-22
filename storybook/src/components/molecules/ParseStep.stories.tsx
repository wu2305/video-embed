import type { Meta, StoryObj } from "@storybook/react-vite";
import { ParseStep } from "./ParseStep";

const meta = {
  title: "Molecules/ParseStep",
  component: ParseStep,
  decorators: [(Story) => <div className="mm-parse"><Story /></div>],
} satisfies Meta<typeof ParseStep>;

export default meta;
type Story = StoryObj<typeof meta>;

export const What: Story = { args: { children: <>what <b>cooking</b></> } };
export const Who: Story = { args: { tone: "accent", children: <>who <b>Ana Ruiz</b> → person-0003</> } };
export const Unresolved: Story = { args: { tone: "bad", children: <>no such person <b>Zed Marlow</b></> } };
