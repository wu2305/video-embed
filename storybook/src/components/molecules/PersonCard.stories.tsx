import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { PersonCard } from "./PersonCard";
import { people, personSamples } from "../../mock/data";

const meta = {
  title: "Molecules/PersonCard",
  component: PersonCard,
  args: { person: people[0]!, sampleSrc: personSamples["person-0003"], onOpen: fn() },
  decorators: [(Story) => <div style={{ width: 200 }}><Story /></div>],
} satisfies Meta<typeof PersonCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Named: Story = {};
/** An unnamed cluster shows its id in mono and a warn tag. */
export const Unnamed: Story = { args: { person: people[2]!, sampleSrc: personSamples["person-0011"] } };
export const Selected: Story = { args: { selected: true } };
export const NoSample: Story = { args: { sampleSrc: undefined } };
