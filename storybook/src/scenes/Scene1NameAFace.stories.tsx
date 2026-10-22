import type { Meta, StoryObj } from "@storybook/react-vite";
import { FaceTagger } from "../components/organisms/FaceTagger";
import { kitchenFaces, kitchenFrame, people } from "../mock/data";

const meta = {
  title: "Scenes/1 · Name a face",
  parameters: { docs: { description: { component: "Mei opens a result, clicks a face box and names the whole cluster. Status: **new** (the index stores no face boxes yet)." } } },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Flow: Story = {
  render: () => <FaceTagger src={kitchenFrame} faces={kitchenFaces} people={people} />,
};
