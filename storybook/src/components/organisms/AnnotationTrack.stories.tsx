import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, userEvent, within } from "storybook/test";
import { AnnotationTrack } from "./AnnotationTrack";
import { annotations, duration, scenes } from "../../mock/data";

const meta = {
  title: "Organisms/AnnotationTrack",
  component: AnnotationTrack,
  args: { duration, scenes, annotations, playhead: 50 },
  render: (args) => {
    const [playhead, setPlayhead] = useState(args.playhead ?? 0);
    return <AnnotationTrack {...args} playhead={playhead} onSeek={setPlayhead} />;
  },
} satisfies Meta<typeof AnnotationTrack>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Click, or use ←/→ (5s), Page Up/Down (30s) and Home/End, to move the playhead. */
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const slider = within(canvasElement).getByRole("slider");
    slider.focus();
    await userEvent.keyboard("{End}");
    await expect(slider).toHaveAttribute("aria-valuenow", String(duration));
    await userEvent.keyboard("{Home}");
    await expect(slider).toHaveAttribute("aria-valuenow", "0");
    await userEvent.keyboard("{PageUp}");
    await expect(slider).toHaveAttribute("aria-valuenow", "30");
  },
};

/** The outlined green band is the scene the search matched; the key under the track names it. A tap seeks, and the slider says when the playhead is inside the match. */
export const WithMatch: Story = {
  args: { matched: { start: 42, end: 71 } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("list", { name: "Timeline key" })).toHaveTextContent("Matched scene 00:42–01:11");
    const slider = canvas.getByRole("slider");
    const track = canvasElement.querySelector<HTMLElement>(".mm-track")!.getBoundingClientRect();
    // A touch tap at 0:56, inside the match: the browser turns it into a click at that point.
    const x = track.left + (track.width * 56) / duration;
    await userEvent.pointer({ keys: "[TouchA]", target: slider, coords: { clientX: x, clientY: track.top + track.height / 2 } });
    await expect(slider).toHaveAttribute("aria-valuenow", "56");
    await expect(slider).toHaveAttribute("aria-valuetext", "00:56, in the matched scene");
  },
};

export const NoNotes: Story = { args: { annotations: [] } };
