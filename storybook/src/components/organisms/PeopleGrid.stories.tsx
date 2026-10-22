import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { PeopleGrid } from "./PeopleGrid";
import { people, personSamples } from "../../mock/data";

const meta = {
  title: "Organisms/PeopleGrid",
  component: PeopleGrid,
  args: { people, samples: personSamples, onOpen: fn() },
} satisfies Meta<typeof PeopleGrid>;

export default meta;
type Story = StoryObj<typeof meta>;

export const All: Story = {};

/** The unnamed filter is the to-do list for naming. */
export const UnnamedOnly: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: /^unnamed/ }));
    await expect(canvas.queryByText("Ana Ruiz")).not.toBeInTheDocument();
    await expect(canvas.getByText("person-0011")).toBeInTheDocument();
  },
};

export const Empty: Story = { args: { people: [] } };
