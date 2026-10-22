import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { TopBar } from "./TopBar";
import { indexInfo, now, staleIndexInfo, viewer } from "../../mock/data";

const meta = {
  title: "Organisms/TopBar",
  component: TopBar,
  parameters: { layout: "fullscreen" },
  args: { current: "search", index: indexInfo, now, viewer, onNavigate: fn() },
} satisfies Meta<typeof TopBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OnSearch: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("link", { name: "Search" })).toHaveAttribute("aria-current", "page");
    await expect(canvas.getByText("Mei Chen")).toBeInTheDocument();
    await userEvent.click(canvas.getByRole("link", { name: "People" }));
    await expect(args.onNavigate).toHaveBeenCalledWith("people");
  },
};
export const OnPeople: Story = { args: { current: "people" } };
/** The nightly cycle has not published for days. */
export const StaleIndex: Story = { args: { index: staleIndexInfo } };
/** Before the first export there is no snapshot to report. */
export const NoSnapshot: Story = { args: { index: undefined } };
