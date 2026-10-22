# design-sync notes

- The shape is `storybook`, but `storybook/` is an app, not a published package. In `storybook/`, `npm run build:lib` bundles `src/index.ts` into `dist/`: esbuild ESM, plus tsc `.d.ts`, plus `styles.css`. That `dist/` is the converter's `--entry`. Re-run it (it's the `buildCmd`) before every re-sync.
- Converter command. If Playwright's download is unavailable, set the env var `DS_CHROMIUM_PATH` to a local Chromium:
  `node .ds-sync/resync.mjs --config .design-sync/config.json --node-modules storybook/node_modules --entry storybook/dist/index.js --out ./ds-bundle --storybook-static .design-sync/sb-reference`. On re-syncs, add `--remote <saved _ds_sync.json>`.
  When stories or components change, rebuild the reference with `cd storybook && VITE_MOCK_PHOTOS=off npx storybook build -c .storybook -o ../.design-sync/sb-reference`.
- [GENERAL] Themes: tokens use `light-dark()` and `body` paints `var(--bg)`, so previews follow the OS theme with no wrapper. In Storybook, `.storybook/preview.tsx` wraps every story in `[data-theme]` (dark by default). The old `.mm-root` decorator is gone.
- [GENERAL] Play functions don't run in previews. The states that stories reached by clicking or typing are reachable through props instead: `FaceTagger.initialSelected/initialName` and `AnnotationComposer.initialText/initialTo`. New interaction-only stories need the same treatment.
- `overrides.ResultGrid.viewport = 1000x760`: at the default viewport, the preview clipped the 4th card of "Populated".
- Sample photos: `scripts/fetch_media.py` fetches Flickr30k test-set keyframes into the gitignored `storybook/src/mock/media/`. Flickr30k is a non-commercial research licence. The reference build above sets `VITE_MOCK_PHOTOS=off` so previews carry the drawn stand-ins instead. Drop that flag only for a team-internal project.

## Re-sync risks
- The last sync predates the atoms/molecules/organisms/templates restructure and the light theme. It compared 8 components and 33 stories, so the pinned project needs a full re-sync, not an incremental one.
- Face boxes and person assignments live in `storybook/src/mock/media.lock.json`. Changing a photo means re-detecting its boxes (`python scripts/fetch_media.py --select`).
- Built with React 19.3 and Storybook 10.6. The converter bundles React via esbuild (no UMD).
- `.design-sync/conventions.md` is hand-written and names `mm-*` classes and `--*` tokens. Re-check them against `_ds_bundle.css` whenever `src/styles.css` changes.
