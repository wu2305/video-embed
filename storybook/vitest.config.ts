import { defineConfig } from "vitest/config";
import { storybookTest } from "@storybook/addon-vitest/vitest-plugin";
import { playwright } from "@vitest/browser-playwright";

// Runs every story (and its play function) in a real browser.
export default defineConfig({
  test: {
    projects: [
      { test: { name: "unit", include: ["src/lib/**/*.test.ts"], environment: "node" } },
      {
        extends: true,
        plugins: [storybookTest({ configDir: ".storybook" })],
        test: {
          name: "storybook",
          browser: {
            enabled: true,
            headless: true,
            provider: playwright({ launchOptions: { executablePath: process.env.CHROMIUM_PATH || undefined } }),
            instances: [{ browser: "chromium" }],
          },
        },
      },
    ],
  },
});
