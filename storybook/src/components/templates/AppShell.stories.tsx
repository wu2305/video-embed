import type { Meta, StoryObj } from "@storybook/react-vite";
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
export const ListPage: Story = { args: { actions: <Button variant="primary">Primary action</Button> } };

/** A detail page adds breadcrumbs and a two-column split. */
export const DetailPage: Story = {
  args: {
    current: "clip", title: "cooking_class_03.mp4",
    crumbs: <><a href="#search">Search</a> / clip</>,
    children: (
      <div className="mm-split">
        <Panel>Main column</Panel>
        <aside><Panel title="Details">Sidebar</Panel></aside>
      </div>
    ),
  },
};
