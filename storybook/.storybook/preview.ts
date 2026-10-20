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
    a11y: { test: "error" },
    options: {
      storySort: {
        order: ["Overview", "Foundations", ["Colour", "Type", "Space and shape"], "Atoms", "Molecules", "Organisms", "Templates", "Pages", ["Prototype", "Search", "People", "Clip"], "Scenes"],
      },
    },
  },
  initialGlobals: { backgrounds: { value: "console" } },
};

export default preview;
