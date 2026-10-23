import type { Face } from "../types";

/* Fixture colours, deliberately not the theme tokens: an overlay must be tested
   against scenery that does not share its hue. */
interface Palette { sky: string; floor: string; props: string[] }

const PALETTES: Record<string, Palette> = {
  kitchen: { sky: "#6b4a2f", floor: "#3a2a1c", props: ["#c9863c", "#8f5a2a", "#d9b27c"] },
  office: { sky: "#243b5e", floor: "#16233a", props: ["#9fb4d6", "#3b5d93", "#cfd9ea"] },
  park: { sky: "#2d5a45", floor: "#1b3a2c", props: ["#8fc79a", "#2f7a55", "#d9e8a2"] },
  night: { sky: "#1b1f33", floor: "#0e1020", props: ["#767d93", "#4a5170", "#d8a85a"] },
};

export type Scenery = keyof typeof PALETTES;

/**
 * A 640x480 stand-in keyframe as an SVG data URI. Faces are drawn at the
 * normalised boxes given, so overlays line up exactly.
 */
export function frame(scenery: Scenery, faces: readonly Face[] = [], caption = ""): string {
  const p = PALETTES[scenery]!;
  const props = p.props
    .map((c, i) => `<rect x="${60 + i * 190}" y="${250 - i * 18}" width="${120 + i * 12}" height="${90 + i * 20}" rx="8" fill="${c}" opacity=".55"/>`)
    .join("");
  const heads = faces
    .map((f) => {
      const [x, y, w, h] = f.bbox;
      const cx = (x + w / 2) * 640, cy = (y + h / 2) * 480;
      return `<ellipse cx="${cx}" cy="${cy}" rx="${(w * 640) / 2.3}" ry="${(h * 480) / 2.1}" fill="#e0b894"/>` +
        `<rect x="${cx - w * 640 * 0.75}" y="${cy + h * 480 * 0.5}" width="${w * 640 * 1.5}" height="${h * 480 * 1.6}" rx="26" fill="#2b3550"/>`;
    })
    .join("");
  const text = caption ? `<text x="24" y="456" fill="#fff" fill-opacity=".7" font-family="monospace" font-size="18">${caption}</text>` : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 480">` +
    `<rect width="640" height="480" fill="${p.sky}"/><rect y="300" width="640" height="180" fill="${p.floor}"/>${props}${heads}${text}</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
