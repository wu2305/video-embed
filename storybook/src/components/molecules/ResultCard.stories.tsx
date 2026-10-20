import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { ResultCard } from "./ResultCard";
import { copyHit, cookingHit, people, photoHit, presentingHit } from "../../mock/data";

const meta = {
  title: "Molecules/ResultCard",
  component: ResultCard,
  args: { hit: cookingHit, rank: 1, people, onOpen: fn() },
  decorators: [(Story) => <div style={{ width: 240 }}><Story /></div>],
} satisfies Meta<typeof ResultCard>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Named people, a note (blue) and ASR text (yellow). */
export const Named: Story = {};

/** Without names the card shows cluster ids, as the console does today. */
export const Anonymous: Story = { args: { hit: presentingHit, people: [] } };

export const Image: Story = { args: { hit: photoHit } };

export const NonMasterCopy: Story = { args: { hit: copyHit } };

export const Selected: Story = { args: { selected: true } };
