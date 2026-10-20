import type { Preview } from "@storybook/react-vite";
import "../src/styles.css";

const preview: Preview = {
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
    backgrounds: {
      options: { console: { name: "console", value: "#0f1115" } },
    },
    controls: { expanded: true },
    options: {
      storySort: {
        order: ["Overview", "Scene 1 · Name a face", "Scene 2 · Write on the video", "Scene 3 · Who is doing what", "Scene 4 · More media, more APIs", "Scene 5 · Preview"],
      },
    },
  },
  initialGlobals: { backgrounds: { value: "console" } },
};

export default preview;
