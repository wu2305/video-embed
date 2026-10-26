import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { SearchBar } from "./SearchBar";

const meta = {
  title: "Organisms/SearchBar",
  component: SearchBar,
  args: { people: [], onSearch: fn() },
} satisfies Meta<typeof SearchBar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The query, a limit, and the source to search: All, NAS, Archive or BI metrics. */
export const Default: Story = {
  args: { initialQuery: "Q3 budget" },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect([...canvas.getByLabelText("type").querySelectorAll("option")].map((o) => o.value)).toEqual(["all", "nas", "archive", "bi"]);
    await userEvent.click(canvas.getByRole("button", { name: "search" }));
    await expect(args.onSearch).toHaveBeenCalledWith(expect.objectContaining({ query: "Q3 budget", type: "all", limit: 12 }));
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
  args: { initialQuery: "Q3 budget", busy: true },
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
