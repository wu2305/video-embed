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
npm test                 # unit tests + every story's play function in headless Chromium
npm run build-storybook  # static site in storybook-static/
```

`npm test` needs a Chromium. Run `npx playwright install chromium`, or point
`CHROMIUM_PATH` at an existing binary.

## Layout

| Path | Contents |
|---|---|
| `src/components/` | One component and its stories per file |
| `src/types.ts` | `Hit` mirrors `SearchHit.to_dict()`. Fields under "proposed" do not exist in the Python code yet |
| `src/lib/parseQuery.ts` | Rule-based "who is what" splitter used by `SearchBar` |
| `src/mock/` | Fake hits, people and notes, with hand-boxed faces on the photos in `src/assets/` |
| `src/styles.css` | Tokens and classes copied from the console page in `scripts/serve.py` |

## Status

`ResultCard` and `ResultGrid` follow the console's existing markup and
classes. Everything else is a proposal: face boxes, notes, the who/what readout,
new media kinds, source badges and the seeking preview all depend on backend
work listed in `../STORYBOOK.md`.

The console in `scripts/serve.py` is still a single inline HTML page. Nothing
here is wired into it yet.

## Sample images

The frames in `src/assets/` are photos from the Flickr30k test set (the
`nlphuji/flickr30k` dataset on Hugging Face, which `src/mmindex/benchmark` also
uses), so the stories show real faces and scenes. They are illustrative only: the
face boxes were drawn by hand, and the names and cluster ids are invented. Flickr30k is
for non-commercial research use; swap in your own frames before publishing the
built Storybook.

| File | Flickr30k row | Used for |
|---|---|---|
| `kitchen.jpg` | 471 | `cooking_class_03.mp4` hits, face tagging |
| `meeting.jpg` | 533 | `q3_review.mp4` hit |
| `picnic.jpg` | 50 | `park_picnic.jpg` photo hit |
| `external.jpg` | 686 | hit from another search API |
