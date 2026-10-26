import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { AnnotationComposer } from "./AnnotationComposer";
import { people } from "../../mock/data";

const meta = {
  title: "Organisms/AnnotationComposer",
  // Media (faces, notes, clips): hidden, since no customer searches images, video or audio. Still tested.
  tags: ["!dev", "!autodocs"],
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
    await expect(canvas.getByRole("status")).toHaveTextContent("Note added.");
  },
};

/** Clearing "to" makes the note open-ended. */
export const OpenEnded: Story = { args: { scene: null, time: 118 } };

export const InvalidRange: Story = {
  args: { initialTo: "00:10", initialText: "x" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.clear(canvas.getByLabelText(/^to/));
    await userEvent.type(canvas.getByLabelText(/^to/), "00:10");
    await expect(canvas.getByRole("alert")).toHaveTextContent("End must be after start");
    await userEvent.type(canvas.getByLabelText("note"), "x");
    // Save stays focusable and names why it cannot run; pressing it focuses the range.
    const save = canvas.getByRole("button", { name: "Save note" });
    await expect(save).toHaveAttribute("aria-disabled", "true");
    await expect(save).toHaveAccessibleDescription("End must be after start.");
    await expect(canvas.getByLabelText(/^to/)).toHaveAccessibleDescription(/End must be after start/);
    await userEvent.click(save);
    await expect(canvas.getByLabelText("from")).toHaveFocus();
  },
};

/** Saving an empty note says so and puts the cursor in the note. Nothing is saved. */
export const EmptyNote: Story = {
  args: { onSave: fn() },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const save = canvas.getByRole("button", { name: "Save note" });
    save.focus();
    await userEvent.keyboard("{Enter}");
    await expect(args.onSave).not.toHaveBeenCalled();
    await expect(canvas.getByText("Type the note first.")).toBeVisible();
    await expect(canvas.getByLabelText("note")).toHaveFocus();
  },
};

/** An image has no time range, so the range fields are hidden. */
export const StillImage: Story = { args: { still: true, scene: null } };
