import type { Meta, StoryObj } from "@storybook/react-vite";
import { Field } from "./Field";

const meta = {
  title: "Molecules/Field",
  component: Field,
  args: { label: "query" },
} satisfies Meta<typeof Field>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Text: Story = { args: { children: <input type="text" placeholder="Q3 budget" /> } };
export const Number: Story = { args: { label: "limit", children: <input type="number" defaultValue={12} style={{ width: 80 }} /> } };
export const Select: Story = {
  args: { label: "source", children: <select><option>all</option><option>NAS</option><option>Archive</option></select> },
};
export const Invalid: Story = { args: { label: "limit", children: <input type="number" defaultValue={0} aria-invalid style={{ width: 80 }} /> } };
