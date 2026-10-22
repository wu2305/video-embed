import type { Meta, StoryObj } from "@storybook/react-vite";
import { Freshness } from "../components/molecules/Freshness";
import { PreviewPanel } from "../components/organisms/PreviewPanel";
import { ResultGrid } from "../components/organisms/ResultGrid";
import { TopBar } from "../components/organisms/TopBar";
import { indexInfo, kitchenFrame, now, people, presentingHit, staleIndexInfo, viewer } from "../mock/data";

const meta = {
  title: "Scenes/7 · Today's files, tomorrow morning",
  parameters: {
    layout: "fullscreen",
    docs: { description: { component: "Mei uploads footage at 10:00 and searches for it at 10:05. Ingestion is nightly, so the console says when it will show up instead of looking broken. Status: **new** (design doc §4.2; the incremental cycle is not built yet)." } },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** A fresh upload is not found yet; the empty state says when it will be. */
export const NotYetIndexed: Story = {
  render: () => (
    <div>
      <TopBar current="search" index={indexInfo} now={now} viewer={viewer} />
      <div style={{ padding: 20, display: "grid", gap: 14 }}>
        <ResultGrid results={[]} people={people} query="launch event rehearsal" />
        <Freshness index={indexInfo} now={now} long />
      </div>
    </div>
  ),
};

/** The nightly cycle has not published for days; every page says so. */
export const StaleIndex: Story = {
  render: () => (
    <div>
      <TopBar current="search" index={staleIndexInfo} now={now} viewer={viewer} />
      <div style={{ padding: 20 }}><Freshness index={staleIndexInfo} now={now} long /></div>
    </div>
  ),
};

/** The file was deleted or moved since the snapshot; it drops out tonight. */
export const FileGoneSinceLastNight: Story = {
  render: () => (
    <div style={{ padding: 20 }}>
      <PreviewPanel hit={presentingHit} position={1} total={1} frameSrc={kitchenFrame} people={people} unavailable="gone" />
    </div>
  ),
};
