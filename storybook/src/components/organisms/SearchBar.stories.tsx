import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { SearchBar } from "./SearchBar";
import { people } from "../../mock/data";

const meta = {
  title: "Organisms/SearchBar",
  component: SearchBar,
  args: { people, onSearch: fn() },
} satisfies Meta<typeof SearchBar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** No name in the query: behaves like today's console. */
export const PlainText: Story = { args: { initialQuery: "a man in a suit" } };

/** A first name resolves to a person; the rest is embedded as the "what". */
export const NamedPerson: Story = {
  args: { initialQuery: "Ana is cooking" },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Ana Ruiz")).toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "search" }));
    await expect(args.onSearch).toHaveBeenCalledWith(
      expect.objectContaining({ parsed: expect.objectContaining({ person_ids: ["person-0003"], what: "cooking" }) }),
    );
  },
};

export const TwoPeople: Story = { args: { initialQuery: "Ana and Ben are cooking" } };

/** A capitalised name nobody owns blocks the search instead of silently falling back to text. */
export const UnknownPerson: Story = {
  args: { initialQuery: "Zed Marlow is cooking" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/no such person/)).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "search" })).toBeDisabled();
  },
};

export const Busy: Story = { args: { initialQuery: "Ana is cooking", busy: true } };
