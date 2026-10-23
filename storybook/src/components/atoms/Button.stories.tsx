import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "./Button";

const meta = {
  title: "Atoms/Button",
  component: Button,
  args: { children: "Copy path" },
  argTypes: { variant: { control: "inline-radio", options: ["default", "primary", "ghost", "danger"] } },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Secondary actions. A panel fill and a resting edge, so it never reads as a text field. */
export const Default: Story = {};
export const Primary: Story = { args: { variant: "primary", children: "search" } };
/** Merging two people: the action is named for what it does. */
export const Danger: Story = { args: { variant: "danger", children: "Merge into Ana Ruiz" } };
export const Ghost: Story = { args: { variant: "ghost", children: "Close" } };
export const Disabled: Story = { args: { variant: "primary", children: "Save note", disabled: true } };
