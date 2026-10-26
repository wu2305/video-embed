import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { Button } from "./Button";

const meta = {
  title: "Atoms/Button",
  component: Button,
  args: { children: "Copy path" },
  argTypes: { variant: { control: "inline-radio", options: ["default", "primary", "ghost", "danger"] } },
  // Each variant is a real button with its own class, and only Disabled refuses clicks.
  play: async ({ canvasElement, args }) => {
    const button = within(canvasElement).getByRole<HTMLButtonElement>("button", { name: String(args.children) });
    await expect(button).toHaveAttribute("type", "button");
    await expect(button).toHaveClass(`mm-${args.variant === undefined || args.variant === "default" ? "button" : args.variant}`);
    await expect(button.disabled).toBe(Boolean(args.disabled));
  },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Secondary actions. A panel fill and a resting edge, so it never reads as a text field. */
export const Default: Story = {};
export const Primary: Story = { args: { variant: "primary", children: "search" } };
/** A destructive action is named for what it does. */
export const Danger: Story = { args: { variant: "danger", children: "Delete saved search" } };
export const Ghost: Story = { args: { variant: "ghost", children: "Close" } };
export const Disabled: Story = { args: { variant: "primary", children: "search", disabled: true } };
