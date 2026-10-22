import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { PeoplePage } from "./PeoplePage";
import { audioHit, hits, indexInfo, now, pendingFaces, people, personSamples, viewer } from "../mock/data";

const meta = {
  title: "Pages/People",
  component: PeoplePage,
  parameters: { layout: "fullscreen" },
  args: {
    people, samples: personSamples, corpus: [...hits, audioHit],
    index: indexInfo, now, viewer, onNavigate: fn(), onName: fn(), onMerge: fn(), onUndoMerge: fn(),
  },
} satisfies Meta<typeof PeoplePage>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Every face cluster, largest first. Nothing selected. */
export const Directory: Story = {};

/** Naming an unnamed cluster updates its card and every appearance. */
export const NameACluster: Story = {
  args: { selectedId: "person-0011" },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByLabelText("name"), "Chidi Eze");
    await userEvent.click(canvas.getByRole("button", { name: "Apply name" }));
    await expect(args.onName).toHaveBeenCalledWith("person-0011", "Chidi Eze");
    await expect(canvas.getByRole("status")).toHaveTextContent("Named 41 appearances");
    await expect(canvas.getByRole("button", { name: "Chidi Eze" })).toBeInTheDocument();
  },
};

/** A named person, with where they appear. */
export const NamedPerson: Story = { args: { selectedId: "person-0003" } };

/** Reusing a name is a merge: the action says so and is styled as one. */
export const MergeWarning: Story = {
  args: { selectedId: "person-0019" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByLabelText("name"), "Ana Ruiz");
    await expect(canvas.getByRole("note")).toHaveTextContent("already names person-0003");
    await expect(canvas.getByRole("button", { name: "Merge into Ana Ruiz" })).toBeInTheDocument();
    await expect(canvas.queryByRole("button", { name: "Apply name" })).toBeNull();
  },
};

/** A merge needs a confirm step naming both clusters and the combined count, and can be undone. */
export const ConfirmAndUndoMerge: Story = {
  args: { selectedId: "person-0019" },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByLabelText("name"), "Ana Ruiz");
    await userEvent.click(canvas.getByRole("button", { name: "Merge into Ana Ruiz" }));
    await expect(args.onMerge).not.toHaveBeenCalled();
    await expect(canvas.getByRole("alert")).toHaveTextContent("Merge person-0019 (17 faces) into person-0003, Ana Ruiz (212 faces)?");
    await expect(canvas.getByRole("alert")).toHaveTextContent("229 appearances");
    await userEvent.click(canvas.getByRole("button", { name: "Confirm merge" }));
    await expect(args.onMerge).toHaveBeenCalledWith("person-0019", "person-0003");
    await expect(args.onName).not.toHaveBeenCalled();
    await expect(canvas.getByRole("status")).toHaveTextContent("Merged person-0019 into Ana Ruiz: 229 appearances.");
    await expect(canvas.queryByRole("button", { name: "person-0019" })).toBeNull();
    await userEvent.click(canvas.getByRole("button", { name: "Undo merge" }));
    await expect(args.onUndoMerge).toHaveBeenCalledWith("person-0019", "person-0003");
    await expect(canvas.getByRole("status")).toHaveTextContent("person-0019 is its own person again.");
    await expect(canvas.getByRole("button", { name: "person-0019" })).toBeInTheDocument();
  },
};

/** Cancelling the confirm step changes nothing. */
export const CancelMerge: Story = {
  args: { selectedId: "person-0019" },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByLabelText("name"), "Ana Ruiz");
    await userEvent.click(canvas.getByRole("button", { name: "Merge into Ana Ruiz" }));
    await userEvent.click(canvas.getByRole("button", { name: "Cancel" }));
    await expect(canvas.queryByRole("alert")).toBeNull();
    await expect(args.onMerge).not.toHaveBeenCalled();
  },
};

/** New faces from recent nights wait in a pending pool until the next full regroup. */
export const PendingFaces: Story = { args: { pendingFaces } };

export const AllNamed: Story = { args: { people: people.map((p, i) => ({ ...p, name: p.name ?? `Guest ${i}` })) } };
