import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, userEvent, within } from "storybook/test";
import { NoteList } from "./NoteList";
import { annotations, people } from "../../mock/data";

const meta = {
  title: "Organisms/NoteList",
  // Media (faces, notes, clips): hidden, since no customer searches images, video or audio. Still tested.
  tags: ["!dev", "!autodocs"],
  component: NoteList,
  args: { notes: annotations, people, playhead: 50 },
  decorators: [(Story) => <div style={{ maxWidth: 380 }}><Story /></div>],
  render: (args) => {
    const [playhead, setPlayhead] = useState(args.playhead ?? 0);
    return <NoteList {...args} playhead={playhead} onSeek={setPlayhead} />;
  },
} satisfies Meta<typeof NoteList>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Clicking a note seeks to it, which makes it current. */
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const budget = canvas.getByRole("button", { name: /Q3 budget/ });
    await userEvent.click(budget);
    await expect(budget).toHaveAttribute("aria-current", "true");
  },
};
export const Empty: Story = { args: { notes: [] } };
