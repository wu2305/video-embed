import type { Meta } from "@storybook/react-vite";
import type { StoryObj } from "@storybook/react-vite";
import { ResultGrid } from "../components/organisms/ResultGrid";
import { fuseByRank } from "../lib/fuse";
import { archiveRecords, audioHit, cookingHit, documentHit, people, photoHit } from "../mock/data";

const meta = {
  title: "Scenes/4 · More media, more sources",
  component: ResultGrid,
  args: { people, query: "Ana Ruiz is cooking" },
} satisfies Meta<typeof ResultGrid>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 4a: a photo (no scene range) sits beside a video hit. */
export const VideoAndImage: Story = { args: { results: [cookingHit, photoHit] } };

/** 4b: audio and documents have no frame, so the card falls back to a glyph. */
export const NewMediaKinds: Story = { args: { results: [cookingHit, audioHit, documentHit] } };

/**
 * 4c: Archive System records merged with NAS hits by rank, not raw score.
 * Archive cards carry metadata only and open in the Archive System.
 */
export const ArchiveSystem: Story = {
  args: { results: fuseByRank([[cookingHit, audioHit, photoHit], archiveRecords.slice(0, 2)]), query: "cooking" },
};
