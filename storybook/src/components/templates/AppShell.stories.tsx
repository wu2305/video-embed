import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { AppShell } from "./AppShell";
import { Button } from "../atoms/Button";
import { Panel } from "../atoms/Panel";
import { indexInfo, now, viewer } from "../../mock/data";

const meta = {
  title: "Templates/AppShell",
  component: AppShell,
  parameters: { layout: "fullscreen" },
  args: {
    current: "search", title: "Page title", subtitle: "One line that says what this page is for.",
    index: indexInfo, now, viewer,
    children: <Panel>Page body</Panel>,
  },
} satisfies Meta<typeof AppShell>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Slots: title, subtitle, actions and body. */
export const ListPage: Story = {
  args: { actions: <Button variant="primary">Primary action</Button> },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { level: 1, name: "Page title" })).toBeVisible();
    await expect(canvas.getByRole("main")).toHaveTextContent("Page body");
    await expect(canvas.getByRole("button", { name: "Primary action" })).toBeVisible();
  },
};
