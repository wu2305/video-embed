import type { Meta, StoryObj } from "@storybook/react-vite";
import { Label } from "./Label";

const meta = { title: "Atoms/Label", component: Label, args: { children: "min faces" } } satisfies Meta<typeof Label>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const GroupHeading: Story = { args: { as: "span", children: "people in frame" } };
