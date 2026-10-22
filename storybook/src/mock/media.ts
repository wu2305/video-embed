import lock from "./media.lock.json";
import { frame } from "./frames";
import type { Face } from "../types";

/**
 * Real keyframes from the Flickr30k test split, fetched by
 * `scripts/fetch_media.py` into `src/mock/media/` (gitignored). The lock file
 * is committed, so face boxes and person assignments are the same whether or
 * not the photos are present; without them each scene falls back to a drawn
 * frame with the same boxes.
 */
const fetched = import.meta.glob<string>("./media/*.jpg", { eager: true, query: "?url", import: "default" });
// VITE_MOCK_PHOTOS=off forces the drawn frames, e.g. for exports that must not carry the photos.
const photos: Record<string, string> = import.meta.env.VITE_MOCK_PHOTOS === "off" ? {} : fetched;

export type Slot = keyof typeof lock.scenes;
type Box = [number, number, number, number];

/** True once the photos have been fetched. */
export const hasPhotos = Object.keys(photos).length > 0;

function photo(name: string): string | undefined {
  return photos[`./media/${name}.jpg`];
}

/** A scene's detected faces, largest first, with the person the lock assigns to each. */
export function sceneFaces(slot: Slot): Face[] {
  const owners = Object.entries(lock.crops).filter(([, crop]) => crop.scene === slot);
  return lock.scenes[slot].faces.map((bbox, face_index) => ({
    face_index,
    bbox: bbox as Box,
    person_id: owners.find(([, crop]) => crop.face === face_index)?.[0] ?? null,
  }));
}

/** The scene's photo, or a drawn stand-in with the same faces. `caption` only shows on the stand-in. */
export function sceneFrame(slot: Slot, caption = ""): string {
  return photo(slot) ?? frame(slot, sceneFaces(slot), caption);
}

/** A person's face crop, or a drawn portrait. */
export function personSample(personId: keyof typeof lock.crops): string {
  const scene = lock.crops[personId].scene as Slot;
  return photo(personId) ?? frame(scene, [{ face_index: 0, bbox: [0.36, 0.2, 0.28, 0.36], person_id: personId }]);
}

/** Where a scene's photo came from, for captions and credits. */
export function sceneSource(slot: Slot): { filename: string; caption: string } {
  const { filename, caption } = lock.scenes[slot];
  return { filename, caption };
}
