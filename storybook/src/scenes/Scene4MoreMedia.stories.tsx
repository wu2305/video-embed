import type { Meta } from "@storybook/react-vite";
import type { StoryObj } from "@storybook/react-vite";
import { ResultGrid } from "../components/organisms/ResultGrid";
import { audioHit, cookingHit, documentHit, externalHit, people, photoHit } from "../mock/data";

const meta = {
  title: "Scenes/4 · More media, more APIs",
  component: ResultGrid,
  args: { people, query: "Ana Ruiz is cooking" },
} satisfies Meta<typeof ResultGrid>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 4a: a photo (no scene range) sits beside a video hit. */
export const VideoAndImage: Story = { args: { hits: [cookingHit, photoHit] } };

/** 4b: audio and documents have no frame, so the card falls back to a glyph. */
export const NewMediaKinds: Story = { args: { hits: [cookingHit, audioHit, documentHit] } };

/** 4c: a hit from another search API carries a source badge. Merge by rank, not raw score. */
export const FederatedSources: Story = {
  args: { hits: [externalHit, cookingHit, audioHit, photoHit], query: "cooking" },
};
