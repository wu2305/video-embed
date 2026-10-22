import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "./Button";

const meta = {
  title: "Atoms/Button",
  component: Button,
  args: { children: "Copy path" },
  argTypes: { variant: { control: "inline-radio", options: ["default", "primary", "ghost"] } },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Primary: Story = { args: { variant: "primary", children: "search" } };
export const Ghost: Story = { args: { variant: "ghost", children: "Close" } };
export const Disabled: Story = { args: { variant: "primary", children: "searching…", disabled: true } };
