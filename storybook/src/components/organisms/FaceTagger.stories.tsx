import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { FaceTagger } from "./FaceTagger";
import { kitchenFaces, kitchenFrame, people } from "../../mock/data";

const meta = {
  title: "Organisms/FaceTagger",
  component: FaceTagger,
  args: { src: kitchenFrame, faces: kitchenFaces, people, onTag: fn(), onUndoTag: fn() },
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
    await expect(canvas.getByRole("status")).toHaveTextContent("Saved.");
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

/** Reusing an existing name turns Apply into a merge action; no separate warning line. */
export const MergeWarning: Story = {
  args: { initialSelected: 2, initialName: "Ana Ruiz" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: /Face 3: person-0011/ }));
    await userEvent.type(canvas.getByLabelText("name"), "Ana Ruiz");
    await expect(canvas.getByRole("button", { name: "Merge into Ana Ruiz" })).toBeInTheDocument();
    await expect(canvas.queryByRole("note")).toBeNull();
  },
};

/** A merge gets the same confirm step and undo as on the People page. */
export const ConfirmAndUndoMerge: Story = {
  args: { initialSelected: 2, initialName: "Ana Ruiz" },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Merge into Ana Ruiz" }));
    await expect(args.onTag).not.toHaveBeenCalled();
    await expect(canvas.getByRole("alert")).toHaveTextContent("Merge person-0011 (41 faces) into person-0003, Ana Ruiz (212 faces)?");
    await userEvent.click(canvas.getByRole("button", { name: "Confirm merge" }));
    await expect(args.onTag).toHaveBeenCalledWith({ face_index: 2, name: "Ana Ruiz", scope: "cluster" });
    await expect(canvas.getByRole("status")).toHaveTextContent("Merged person-0011.");
    await userEvent.click(canvas.getByRole("button", { name: "Undo merge" }));
    await expect(args.onUndoTag).toHaveBeenCalledWith({ face_index: 2, name: "Ana Ruiz", scope: "cluster" });
    await expect(canvas.getByRole("status")).toHaveTextContent("person-0011 is no longer merged.");
  },
};

/** Applying with no name says so and puts the cursor in the field. */
export const EmptyName: Story = {
  args: { initialSelected: 3 },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const apply = canvas.getByRole("button", { name: "Apply name" });
    await expect(apply).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(apply);
    await expect(args.onTag).not.toHaveBeenCalled();
    await expect(canvas.getByText("Type a name first.")).toBeVisible();
    await expect(canvas.getByLabelText("name")).toHaveFocus();
  },
};
