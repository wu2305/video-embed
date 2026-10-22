import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { FaceTagger } from "./FaceTagger";
import { kitchenFaces, kitchenFrame, people } from "../../mock/data";

const meta = {
  title: "Organisms/FaceTagger",
  component: FaceTagger,
  args: { src: kitchenFrame, faces: kitchenFaces, people, onTag: fn() },
} satisfies Meta<typeof FaceTagger>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Nothing selected yet. */
export const Idle: Story = {};

/** An unnamed cluster: naming it covers every appearance. */
export const NameACluster: Story = {
  args: { initialSelected: 2, initialName: "Chidi Eze" },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: /Face 3: person-0011/ }));
    await userEvent.type(canvas.getByLabelText("name"), "Chidi Eze");
    await userEvent.click(canvas.getByRole("button", { name: "Apply name" }));
    await expect(args.onTag).toHaveBeenCalledWith({ face_index: 2, name: "Chidi Eze", scope: "cluster" });
    await expect(canvas.getByRole("status")).toHaveTextContent("Named 41 appearances");
  },
};

/** A face with no cluster can only be named on its own. */
export const UntaggedFace: Story = {
  args: { initialSelected: 3 },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: /Face 4: untagged/ }));
    await expect(canvas.getByLabelText(/All appearances/)).toBeDisabled();
    await expect(canvas.getByLabelText(/This face only/)).toBeChecked();
  },
};

/** Reusing an existing name warns that two clusters will merge. */
export const MergeWarning: Story = {
  args: { initialSelected: 2, initialName: "Ana Ruiz" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: /Face 3: person-0011/ }));
    await userEvent.type(canvas.getByLabelText("name"), "Ana Ruiz");
    await expect(canvas.getByRole("note")).toHaveTextContent("already names another cluster");
  },
};
