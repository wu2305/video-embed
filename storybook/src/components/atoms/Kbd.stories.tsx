import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { Kbd } from "./Kbd";

const meta = { title: "Atoms/Kbd", component: Kbd, args: { children: "Esc" } } satisfies Meta<typeof Kbd>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector(".mm-kbd")).toHaveTextContent("Esc");
  },
};
