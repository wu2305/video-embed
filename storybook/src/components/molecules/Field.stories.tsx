import type { Meta, StoryObj } from "@storybook/react-vite";
import { Field } from "./Field";

const meta = {
  title: "Molecules/Field",
  component: Field,
  args: { label: "query" },
} satisfies Meta<typeof Field>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Text: Story = { args: { children: <input type="text" placeholder="Ana Ruiz is cooking" /> } };
export const Number: Story = { args: { label: "limit", children: <input type="number" defaultValue={12} style={{ width: 80 }} /> } };
export const Select: Story = {
  args: { label: "person", children: <select><option>any</option><option>Ana Ruiz (212)</option></select> },
};
export const Invalid: Story = { args: { label: "from", children: <input type="text" defaultValue="9:99:99" aria-invalid /> } };
