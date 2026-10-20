# mmindex console: conventions

Dark, dense, monospace-accented UI for a media search console. No CSS-in-JS, no provider, no theme prop: components are styled by plain classes from `styles.css` plus CSS variables.

## Setup
- Link `styles.css` (it imports `_ds_bundle.css`, which holds the tokens, base element rules and every class below) and load `_ds_bundle.js` after React. Components live at `window.Mmindex.*`.
- Wrap your page or screen in `<div className="mm-root">`. It sets the console ground (`var(--bg)`) and text colour. Without it the light text sits on the host page's default background and is unreadable.
- Components take data as props only (no fetching). Callbacks (`onOpen`, `onSearch`, `onTag`, `onSave`, `onSeek`, `onPrev`, `onNext`, `onClose`) are optional.

## Tokens (CSS variables, use these, never hex)
`--bg` page, `--panel` raised surface, `--line` borders, `--text`, `--muted` secondary text, `--accent` links/primary, `--good`, `--warn`, `--bad` status, `--mono` monospace stack.

## Classes for your own layout glue
- Surfaces and text: `mm-panel` (bordered card), `mm-mono` (small muted monospace), `mm-label` (uppercase caption), `mm-text` (amber excerpt; `mm-text note` = blue user note).
- Controls: `mm-primary` (filled accent button), `mm-ghost` (quiet button), `mm-field` (label stacked over an input), `mm-row` (wrapping flex row), `mm-chips` / `mm-chip` (toggle pills; set `aria-pressed`).
- Badges: `mm-tag` plus `warn`, `accent`, `good` or `bad`.
- Media: `mm-stage` (position:relative frame for an image or video with face boxes on top), `mm-grid` (auto-fill card grid).
Raw `input`, `select`, `textarea` and `button` are already styled by the base rules. Do not invent new class names or colours.

## Where to read
`styles.css` and its `_ds_bundle.css` import are the source of truth for every class and variable. Per component: `components/<group>/<Name>/<Name>.prompt.md` and `<Name>.d.ts`. Data types (`Hit`, `Person`, `Face`, `Annotation`, `Scene`) are in the `.d.ts` files.

## Build snippet
```jsx
const { SearchBar, ResultGrid } = window.Mmindex;
function Console({ people, hits }) {
  return (
    <div className="mm-root" style={{ padding: 16, display: "grid", gap: 14 }}>
      <SearchBar people={people} onSearch={(p) => console.log(p.parsed)} />
      <ResultGrid hits={hits} query="Ana is cooking" people={people} />
      <div className="mm-panel mm-row">
        <span className="mm-tag good">4 hits</span>
        <button className="mm-ghost">Export</button>
      </div>
    </div>
  );
}
```
