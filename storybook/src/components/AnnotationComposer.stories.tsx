import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { AnnotationComposer } from "./AnnotationComposer";
import { people } from "../mock/data";

const meta = {
  title: "Scene 2 · Write on the video/AnnotationComposer",
  component: AnnotationComposer,
  args: { time: 44, scene: { start: 42, end: 71 }, inFrame: people.slice(0, 2), people, onSave: fn() },
  decorators: [(Story) => <div style={{ maxWidth: 420 }}><Story /></div>],
} satisfies Meta<typeof AnnotationComposer>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The scene under the playhead pre-fills the range. */
export const Default: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByLabelText("note"), "Ana is presenting the Q3 budget");
    await userEvent.click(canvas.getByRole("button", { name: "Ana Ruiz" }));
    await userEvent.click(canvas.getByRole("button", { name: "Save note" }));
    await expect(args.onSave).toHaveBeenCalledWith({
      t_start: 42, t_end: 71, text: "Ana is presenting the Q3 budget", person_ids: ["person-0003"],
    });
  },
};

/** Clearing "to" makes the note open-ended. */
export const OpenEnded: Story = { args: { scene: null, time: 118 } };

export const InvalidRange: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.clear(canvas.getByLabelText(/^to/));
    await userEvent.type(canvas.getByLabelText(/^to/), "00:10");
    await expect(canvas.getByRole("alert")).toHaveTextContent("End must be after start");
    await userEvent.type(canvas.getByLabelText("note"), "x");
    await expect(canvas.getByRole("button", { name: "Save note" })).toBeDisabled();
  },
};

/** An image has no time range, so the range fields are hidden. */
export const StillImage: Story = { args: { still: true, scene: null } };
