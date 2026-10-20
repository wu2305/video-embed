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
        order: ["Overview", "Atoms", "Molecules", "Organisms", "Scenes"],
      },
    },
  },
  initialGlobals: { backgrounds: { value: "console" } },
};

export default preview;
