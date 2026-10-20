import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { TopBar } from "./TopBar";
import { indexInfo } from "../../mock/data";

const meta = {
  title: "Organisms/TopBar",
  component: TopBar,
  parameters: { layout: "fullscreen" },
  args: { current: "search", units: indexInfo.units, snapshot: indexInfo.snapshot, onNavigate: fn() },
} satisfies Meta<typeof TopBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OnSearch: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("link", { name: "Search" })).toHaveAttribute("aria-current", "page");
    await userEvent.click(canvas.getByRole("link", { name: "People" }));
    await expect(args.onNavigate).toHaveBeenCalledWith("people");
  },
};
export const OnPeople: Story = { args: { current: "people" } };
/** Before the first export there is no snapshot to report. */
export const NoSnapshot: Story = { args: { units: undefined, snapshot: undefined } };
