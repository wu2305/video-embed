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
      ["path", <span className="mm-mono">/media/2025/cooking_class_03.mp4</span>],
      ["kind", <Tag>video</Tag>],
      ["duration", "03:00"],
      ["scenes", "6"],
      ["copies", <Tag tone="warn">1 copy</Tag>],
    ],
  },
};
