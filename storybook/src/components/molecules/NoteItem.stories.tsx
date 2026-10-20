import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { NoteItem } from "./NoteItem";
import { annotations, people } from "../../mock/data";

const meta = {
  title: "Molecules/NoteItem",
  component: NoteItem,
  args: { note: annotations[0]!, people, onSeek: fn() },
  decorators: [(Story) => <div style={{ maxWidth: 380 }}><Story /></div>],
} satisfies Meta<typeof NoteItem>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
/** The playhead is inside this note. */
export const Current: Story = { args: { current: true } };
/** No end time: the note runs to the end of the clip. */
export const OpenEnded: Story = { args: { note: annotations[2]! } };
