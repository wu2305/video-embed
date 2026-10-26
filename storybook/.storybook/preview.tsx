import type { Decorator, Preview } from "@storybook/react-vite";
import { useEffect } from "react";
import "../src/styles.css";
import "./theme.css";
import { LocaleProvider, LOCALES, type Locale } from "../src/i18n";

type Theme = "dark" | "light" | "side-by-side";

/**
 * Renders the story in the language picked in the toolbar. Components read it
 * through useI18n, so the UI strings and the story content switch together.
 */
const withLocale: Decorator = (Story, context) => {
  const locale = (context.globals.locale ?? "en") as Locale;
  return <LocaleProvider locale={locale}><Story /></LocaleProvider>;
};

/**
 * Pins the story to a theme by setting data-theme on a wrapper. "Side by side"
 * renders the story twice, dark then light; each pane is its own containing
 * block, so fixed layers such as the preview dialog stay inside their pane.
 */
const withTheme: Decorator = (Story, context) => {
  const theme = (context.globals.theme ?? "dark") as Theme;
  const fullscreen = context.parameters.layout === "fullscreen";

  // In story view the canvas body takes the theme too, so padded stories have
  // no seam. Docs pages keep Storybook's own background.
  const storyView = context.viewMode === "story";
  useEffect(() => {
    const root = document.documentElement;
    if (!storyView || theme === "side-by-side") root.removeAttribute("data-sb-canvas");
    else root.setAttribute("data-sb-canvas", theme);
  }, [theme, storyView]);

  if (theme !== "side-by-side") {
    return <div data-theme={theme} className={`sb-theme${fullscreen ? " sb-fullscreen" : ""}`}><Story /></div>;
  }
  return (
    <div className={`sb-themes${fullscreen ? " sb-fullscreen" : ""}`}>
      {(["dark", "light"] as const).map((t) => (
        <div key={t} data-theme={t} className="sb-theme sb-pane" aria-label={`${t} theme`} role="region">
          <Story />
        </div>
      ))}
    </div>
  );
};

const preview: Preview = {
  tags: ["autodocs"],
  decorators: [withLocale, withTheme],
  globalTypes: {
    locale: {
      description: "Language",
      toolbar: {
        title: "Language",
        icon: "globe",
        items: LOCALES.map((l) => ({ value: l.value, title: l.title })),
        dynamicTitle: true,
      },
    },
    theme: {
      description: "Colour theme",
      toolbar: {
        title: "Theme",
        icon: "mirror",
        items: [
          { value: "dark", title: "Dark", icon: "moon" },
          { value: "light", title: "Light", icon: "sun" },
          { value: "side-by-side", title: "Side by side", icon: "sidebyside" },
        ],
        dynamicTitle: true,
      },
    },
  },
  // `npm test` runs every story in both themes; VITE_SB_THEME picks the pass.
  initialGlobals: { theme: import.meta.env.VITE_SB_THEME === "light" ? "light" : "dark", locale: "en" },
  parameters: {
    layout: "padded",
    backgrounds: { disable: true },
    controls: { expanded: true },
    a11y: { test: "error" },
    options: {
      storySort: {
        order: [
          "Overview", "Foundations", ["Colour", "Type", "Space and shape"],
          "Atoms", "Molecules", "Organisms", "Templates",
          "Pages", ["Overview", "Search"], "Scenes",
        ],
      },
    },
  },
};

export default preview;
