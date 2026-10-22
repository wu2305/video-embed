# Unified Search component gallery

A Storybook (React + Vite) for the Unified Search Gateway's console and the scenes in
[`../STORYBOOK.md`](../STORYBOOK.md): naming faces, writing notes on a video,
searching "who is doing what", NAS media and Archive System results in one list, the result
preview, per-user permission filtering, and nightly index freshness. The product it designs for is
in [`../docs/UNIFIED_SEARCH_DESIGN.md`](../docs/UNIFIED_SEARCH_DESIGN.md).

The gallery is self-contained. Data is mocked in `src/mock/`, so it needs no
index, model weights or running `scripts/serve.py`.

```bash
cd storybook
npm install
npm run storybook        # http://localhost:6006
npm run typecheck
npm test                 # every story, in dark then light
npm run build-storybook  # static site in storybook-static/
```

## Themes

Every colour token has a light and a dark value (`light-dark()` in `src/styles.css`). A page follows the
OS setting; `data-theme="light"` or `"dark"` on any element pins that subtree. In Storybook, the
**Theme** toolbar switches between Dark, Light and Side by side. `npm test` runs every story in both
themes, so a contrast regression in either fails the run.

**Pages/Overview** shows every page as a live preview, in both themes, at desktop and phone size.

## Real photos

The mock keyframes are drawn SVGs until you fetch real ones. These are four photos from the Flickr30k
test split on Hugging Face (`lmms-lab-encoder/flickr30k`), the same set the benchmark uses:

```bash
pip install huggingface_hub pyarrow pillow
npm run fetch-media      # about 50 MB of range reads; writes src/mock/media/ (gitignored)
```

`src/mock/media.lock.json` (committed) names each photo and holds its detected face boxes and which face
is which mock person. The drawn frames use the same boxes, so stories and tests behave the same either
way. To choose different photos, run `python scripts/fetch_media.py --select` (needs opencv-python for
face detection) and see the script's docstring for `--only` and `--pin`.

Flickr30k is licensed for non-commercial research and education, and the photos stay the copyright of
their Flickr owners. Check that this covers your use before showing them outside the team; the repo does
not redistribute them.

## Layout

| Path | Contents |
|---|---|
| `src/foundations/` | Colour, type, space and shape docs (MDX) |
| `src/components/atoms/` | Button, Tag, Label, Chip, Kbd, Panel |
| `src/components/molecules/` | Field, ParseStep, FaceBox, ResultCard, ArchiveCard, Freshness, PersonCard, NoteItem, MetaList |
| `src/components/organisms/` | TopBar, SearchBar, ResultGrid, PeopleGrid, FaceOverlay, FaceTagger, AnnotationTrack, AnnotationComposer, NoteList, PreviewPanel |
| `src/components/templates/` | AppShell |
| `src/pages/` | Search, People and Clip pages, and a click-through prototype for demos |
| `src/scenes/` | One story per scene in `../STORYBOOK.md`, composed from organisms |
| `scripts/fetch_media.py` | Fetches the real keyframes from Hugging Face; `--select` picks new ones |
| `src/types.ts` | `Hit` mirrors `SearchHit.to_dict()`. Fields under "proposed" do not exist in the Python code yet. `ArchiveRecord`, `Viewer` and `IndexInfo` are proposals for the gateway |
| `src/lib/parseQuery.ts` | Rule-based "who is what" splitter used by `SearchBar` |
| `src/lib/fuse.ts` | Reciprocal rank fusion of NAS and Archive results; positions only, never raw scores |
| `src/mock/` | Fake hits, Archive records, people, notes, the signed-in user and index freshness; keyframes from `media.ts` (real photos when fetched, SVG otherwise). `now` is pinned so "updated today 02:40" is stable |
| `src/styles.css` | Tokens (top of file) and classes; every rule uses a token, values from the console page in `scripts/serve.py` |

## Status

`ResultCard` and `ResultGrid` follow the console's existing markup and
classes. Everything else is a proposal: face boxes, notes, the who/what readout,
new media kinds, Archive results, sign-in and permission states, index freshness
and the seeking preview all depend on backend work listed in `../STORYBOOK.md`.

The console in `scripts/serve.py` is still a single inline HTML page. Nothing
here is wired into it yet.
