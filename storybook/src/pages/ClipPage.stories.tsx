import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { ClipPage } from "./ClipPage";
import { annotations, audioHit, cookingHit, duration, hitFaces, indexInfo, kitchenFaces, kitchenFrame, people, photoHit, scenes } from "../mock/data";

const meta = {
  title: "Pages/Clip",
  component: ClipPage,
  parameters: { layout: "fullscreen" },
  args: {
    hit: cookingHit, frameSrc: kitchenFrame, faces: kitchenFaces, people, scenes, duration, annotations,
    units: indexInfo.units, snapshot: indexInfo.snapshot, onNavigate: fn(), onBack: fn(),
  },
} satisfies Meta<typeof ClipPage>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Opens on the matched scene, with faces named and the note under the playhead overlaid. */
export const Video: Story = {};

/** Write a note on the scene under the playhead; it lands on the timeline and in the list. */
export const AddNote: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByLabelText("note"), "Ben tastes the sauce");
    await userEvent.click(canvas.getByRole("button", { name: "Save note" }));
    await expect(canvas.getByRole("heading", { name: "Notes (4)" })).toBeInTheDocument();
  },
};

export const NoNotes: Story = { args: { annotations: [] } };

/** A photo: no timeline, notes have no time range. */
export const Photo: Story = { args: { hit: photoHit, frameSrc: photoHit.thumb_url!, faces: hitFaces(photoHit), annotations: [] } };

/** Audio: a timeline but no frame; the transcript carries the match. */
export const Audio: Story = { args: { hit: audioHit, faces: [], annotations: [] } };
