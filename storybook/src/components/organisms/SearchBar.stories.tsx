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
    await expect(canvasElement.querySelector(".mm-parse")).toBeNull();
    await userEvent.click(canvas.getByRole("button", { name: "search" }));
    await expect(args.onSearch).toHaveBeenCalledWith(
      expect.objectContaining({ parsed: expect.objectContaining({ person_ids: ["person-0003"], what: "cooking" }) }),
    );
  },
};

/** People are named in the query, several at once; there is no person-id picker. */
export const TwoPeople: Story = {
  args: { initialQuery: "Ana and Ben are cooking" },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByLabelText("person")).toBeNull();
    await userEvent.click(canvas.getByRole("button", { name: "search" }));
    await expect(args.onSearch).toHaveBeenCalledWith(
      expect.objectContaining({ parsed: expect.objectContaining({ person_ids: ["person-0003", "person-0007"], what: "cooking" }) }),
    );
  },
};

/** A capitalised name nobody owns blocks the search instead of silently falling back to text. */
export const UnknownPerson: Story = {
  args: { initialQuery: "Zed Marlow is cooking" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const button = canvas.getByRole("button", { name: "search" });
    await expect(button).toHaveAttribute("aria-disabled", "true");
    await expect(button).toHaveAccessibleDescription(/Nobody is named Zed Marlow/);
  },
};

/** An empty query: the button stays focusable, says why it cannot search, and shows the reason when pressed. */
export const EmptyQuery: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const button = canvas.getByRole("button", { name: "search" });
    await userEvent.tab();
    await userEvent.tab();
    await userEvent.tab();
    await userEvent.tab();
    await expect(button).toHaveFocus();
    await expect(button).toHaveAccessibleDescription(/Type something to search for/);
    await userEvent.keyboard("{Enter}");
    await expect(args.onSearch).not.toHaveBeenCalled();
    await expect(canvas.getByText(/Type something to search for/)).toBeVisible();
  },
};

/** Busy keeps the label and the fill and adds a spinner, so the row does not reflow. */
export const Busy: Story = {
  args: { initialQuery: "Ana is cooking", busy: true },
  play: async ({ canvasElement }) => {
    const button = within(canvasElement).getByRole("button", { name: "search" });
    await expect(button).toHaveAttribute("aria-disabled", "true");
    await expect(button.querySelector(".mm-spinner")).not.toBeNull();
  },
};

/** A user with a clear aim narrows the search to one type before it runs. */
export const PickType: Story = {
  args: { initialQuery: "revenue" },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByLabelText("min faces")).toBeNull();
    await userEvent.selectOptions(canvas.getByLabelText("type"), "BI metrics");
    await userEvent.click(canvas.getByRole("button", { name: "search" }));
    await expect(args.onSearch).toHaveBeenCalledWith(expect.objectContaining({ query: "revenue", type: "bi" }));
  },
};
