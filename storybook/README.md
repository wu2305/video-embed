# mmindex component gallery

A Storybook (React + Vite) for the query console and the scenes in
[`../STORYBOOK.md`](../STORYBOOK.md): naming faces, writing notes on a video,
searching "who is doing what", mixed media and APIs, and the result preview.

The gallery is self-contained. Data is mocked in `src/mock/`, so it needs no
index, model weights or running `scripts/serve.py`.

```bash
cd storybook
npm install
npm run storybook        # http://localhost:6006
npm run typecheck
npm run build-storybook  # static site in storybook-static/
```

## Layout

| Path | Contents |
|---|---|
| `src/components/atoms/` | Button, Tag, Label, Chip, Kbd |
| `src/components/molecules/` | Field, ParseStep, FaceBox, ResultCard |
| `src/components/organisms/` | SearchBar, ResultGrid, FaceOverlay, FaceTagger, AnnotationTrack, AnnotationComposer, PreviewPanel |
| `src/scenes/` | One story per scene in `../STORYBOOK.md`, composed from organisms |
| `src/types.ts` | `Hit` mirrors `SearchHit.to_dict()`. Fields under "proposed" do not exist in the Python code yet |
| `src/lib/parseQuery.ts` | Rule-based "who is what" splitter used by `SearchBar` |
| `src/mock/` | Fake hits, people, notes and SVG keyframes |
| `src/styles.css` | Tokens and classes copied from the console page in `scripts/serve.py` |

## Status

`ResultCard` and `ResultGrid` follow the console's existing markup and
classes. Everything else is a proposal: face boxes, notes, the who/what readout,
new media kinds, source badges and the seeking preview all depend on backend
work listed in `../STORYBOOK.md`.

The console in `scripts/serve.py` is still a single inline HTML page. Nothing
here is wired into it yet.
