import type { Meta, StoryObj } from "@storybook/react-vite";
import { Panel } from "./Panel";

const meta = {
  title: "Atoms/Panel",
  component: Panel,
  args: { children: "Panels hold forms and read-outs on the page background." },
  decorators: [(Story) => <div style={{ maxWidth: 420 }}><Story /></div>],
} satisfies Meta<typeof Panel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Plain: Story = {};
export const WithTitle: Story = { args: { as: "section", title: "Details" } };
