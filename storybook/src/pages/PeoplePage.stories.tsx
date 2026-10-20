import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { PeoplePage } from "./PeoplePage";
import { audioHit, hits, indexInfo, people, personSamples } from "../mock/data";

const meta = {
  title: "Pages/People",
  component: PeoplePage,
  parameters: { layout: "fullscreen" },
  args: {
    people, samples: personSamples, corpus: [...hits, audioHit],
    units: indexInfo.units, snapshot: indexInfo.snapshot, onNavigate: fn(), onName: fn(),
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

/** Reusing a name warns that two clusters will merge. */
export const MergeWarning: Story = {
  args: { selectedId: "person-0019" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByLabelText("name"), "Ana Ruiz");
    await expect(canvas.getByRole("note")).toHaveTextContent("already names another cluster");
  },
};

export const AllNamed: Story = { args: { people: people.map((p, i) => ({ ...p, name: p.name ?? `Guest ${i}` })) } };
