#!/usr/bin/env node
// Renders the Storybook pages to static HTML showcase cards for the design
// system artifact: <out>/components/<Name>/preview.html and README.md.
//
//   VITE_MOCK_PHOTOS=off node scripts/export_pages.mjs <out-dir>
//
// Pages render with react-dom/server through Vite, so they are the real
// components and mock data; the cards are static (no script), styled by the
// system's tokens.css and bundle.css. Heights are measured in Chromium against
// src/styles.css, which holds the same rules.
import fs from "node:fs";
import path from "node:path";
import { createServer } from "vite";
import { chromium } from "playwright";

const out = process.argv[2];
if (!out) { console.error("usage: export_pages.mjs <out-dir>"); process.exit(1); }
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

const vite = await createServer({ root, logLevel: "error", server: { middlewareMode: true }, appType: "custom" });
const { PAGES, render } = await vite.ssrLoadModule("/src/pages/export/pages.tsx");
const css = fs.readFileSync(path.join(root, "src/styles.css"), "utf8");

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
for (const page of PAGES) {
  const markup = render(page);
  if (/<\/?script|<iframe/i.test(markup)) throw new Error(`${page.name}: markup has a script or iframe`);
  const tab = await browser.newPage({ viewport: { width: page.width, height: 800 } });
  await tab.setContent(`<!doctype html><html data-theme="dark"><head><style>${css}</style></head><body>${markup}</body></html>`);
  const height = await tab.evaluate(() => Math.ceil(document.documentElement.scrollHeight));
  await tab.close();
  const dir = path.join(out, "components", page.name);
  fs.mkdirSync(dir, { recursive: true });
  const marker = `<!-- @dsCard group="Examples" page width=${page.width} height=${height} subtitle="${page.title}" -->`;
  fs.writeFileSync(path.join(dir, "preview.html"), `${marker}\n${markup}\n`);
  fs.writeFileSync(path.join(dir, "README.md"),
    `${page.summary}\n\nA static rendition of the Storybook page \`${page.story}\` (Pages in the sidebar), rendered from the real components and mock data. ` +
    `It follows the system's theme. The live page in Storybook is interactive and shows the real Flickr30k keyframes once they are fetched; here the keyframes are drawn stand-ins with the same face boxes.\n`);
  console.log(`${page.name}: ${page.width}x${height}, ${(markup.length / 1024).toFixed(0)} KB`);
}
await browser.close();
await vite.close();
