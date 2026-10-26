import type { Meta, StoryObj } from "@storybook/react-vite";
import { MetaList } from "./MetaList";
import { Tag } from "../atoms/Tag";

const meta = {
  title: "Molecules/MetaList",
  component: MetaList,
  decorators: [(Story) => <div style={{ maxWidth: 360 }}><Story /></div>],
} satisfies Meta<typeof MetaList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const File: Story = {
  args: {
    items: [
      ["path", <span className="mm-mono">/nas/finance/2025/Q3_budget_review.xlsx</span>],
      ["kind", <Tag>document</Tag>],
      ["copies", <Tag tone="warn">1 copy</Tag>],
    ],
  },
};
