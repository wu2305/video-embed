# design-sync notes

- Shape is `storybook`, but `storybook/` is an app, not a published package. `npm run build:lib` (in `storybook/`) bundles `src/index.ts` into `dist/` (esbuild ESM + tsc `.d.ts` + `styles.css`); that dist is the converter's `--entry`. Re-run it (`buildCmd`) before any re-sync.
- Converter commands (env `DS_CHROMIUM_PATH` = a local chromium if Playwright's download is unavailable):
  `node .ds-sync/resync.mjs --config .design-sync/config.json --node-modules storybook/node_modules --entry storybook/dist/index.js --out ./ds-bundle --storybook-static .design-sync/sb-reference` (add `--remote <saved _ds_sync.json>` on re-syncs).
  Rebuild the reference with `cd storybook && npx storybook build -c .storybook -o ../.design-sync/sb-reference` when stories or components change.
- [GENERAL] Previews and Storybook render on the white page unless wrapped: `.storybook/preview.ts` has a global decorator wrapping every story in `.mm-root` (dark ground). Removing it makes the light text unreadable in previews.
- [GENERAL] Play functions do not run in previews. States that stories reached by clicking/typing are now reachable via props instead (`FaceTagger.initialSelected/initialName`, `AnnotationComposer.initialText/initialTo`). New interaction-only stories need the same treatment.
- Story title "Mixed results" (Scene 4) reuses `ResultGrid`; excluded via `titleMap: {"Mixedresults": null}` so it does not create a bogus component.
- `overrides.ResultGrid.viewport = 1000x760`: at the default viewport the 4th card of "Populated" was clipped in the preview.
- Sample photos in `storybook/src/assets/` are Flickr30k test-set images (non-commercial research licence); they are inlined into previews. Swap them before sharing the project outside the team.

## Re-sync risks
- Accepted `close`: FaceTagger / Name A Cluster. The Storybook render also shows the "saved" status line that appears only after its play function clicks Apply; the preview shows the same pre-filled state without it.
- Only one story per component was compared against the storybook for 8 components, 33 stories total; all graded from images (no sibling-trusted verdicts).
- The face boxes in `src/mock/data.ts` are hand-placed on the photos; replacing an image means re-placing its boxes.
- Built with React 19.3 and storybook 10.6; the converter bundled React via esbuild (no UMD).
- Hand-written `.design-sync/conventions.md` names `mm-*` classes and `--*` tokens; re-validate them against `_ds_bundle.css` whenever `src/styles.css` changes.
