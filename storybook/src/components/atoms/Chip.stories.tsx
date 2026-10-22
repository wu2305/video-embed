import type { Meta, StoryObj } from "@storybook/react-vite";
import { Chip } from "./Chip";

const meta = { title: "Atoms/Chip", component: Chip, args: { children: "Ana Ruiz" } } satisfies Meta<typeof Chip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Off: Story = {};
export const On: Story = { args: { pressed: true } };
