# mmindex console: conventions

A dense media-search console with monospace accents, in light and dark themes. Styling is plain classes from `styles.css` plus CSS variables. There is no CSS-in-JS, no provider and no theme prop.

## Setup
- Link `styles.css`, then load `_ds_bundle.js` after React. `styles.css` imports `_ds_bundle.css`, which holds the tokens, the base element rules and every class below. The components are at `window.Mmindex.*`.
- Theme: every colour is `light-dark(<light>, <dark>)`, so a page follows the OS setting. To pin a subtree, put `data-theme="light"` or `data-theme="dark"` on any element. `body` already gets `var(--bg)` and `var(--text)`, so no wrapper class is needed.
- Motion is opt-in. Transitions only run under `prefers-reduced-motion: no-preference`.
- Components take data as props only; they do no fetching. Every callback is optional: `onSearch`, `onOpen`, `onSelect`, `onTag`, `onSave`, `onSeek`, `onPrev`, `onNext`, `onClose`, `onRetry`, `onNavigate`.

## Tokens (CSS variables: always use these, never hex)
- Surfaces: `--bg` page, `--panel` raised surface, `--field` inputs, `--thumb` media well, `--line` borders.
- Text and signal: `--text`, `--muted`, `--accent` (links and primary), `--accent-strong`, `--on-accent`, `--good`, `--warn`, `--bad`.
- On photos and video: `--scrim`, `--on-scrim`, `--image-accent`, `--image-good`, `--image-warn`.
- Type: `--font-sans`, `--mono`, and the sizes `--text-xs` / `--text-sm` / `--text-md` / `--text-lg` / `--text-xl`. `--measure` caps the width of prose.
- Space and shape: `--space-1` to `--space-6`, `--radius-sm` / `--radius-md` / `--radius-lg` / `--radius-pill`, `--control-min`, `--touch-min`.

## Prefer components, then classes
- Use `Button` (`variant` is `default`, `primary`, `ghost` or `danger`), `Tag` (`tone` is `neutral`, `good`, `accent`, `warn` or `bad`), `Chip` (`pressed`), `Panel` and `Field`. Don't hand-write their markup.
- For your own layout glue:
  - Surfaces and text: `mm-panel` (bordered card), `mm-mono` (small muted monospace), `mm-hint` (muted prose capped at `--measure`), `mm-label` (uppercase caption), `mm-text` (muted excerpt; `mm-text note` is an accent user note).
  - Layout: `mm-row` (wrapping flex row), `mm-grid` (auto-fill card grid), `mm-stage` (a `position: relative` frame for an image or video with face boxes on top).
  - Messages: `mm-notice`, plus `warn` or `bad`, for an inline message.
  - Screen readers: `mm-sr-only` for text that only they should read.

Raw `input`, `select`, `textarea` and `button` already get the base rules. Don't invent new class names or colours.

## Where to read
`styles.css` and the `_ds_bundle.css` it imports are the source of truth for every class and variable. For each component, read `components/<group>/<Name>/<Name>.prompt.md` and `<Name>.d.ts`. The data types (`Hit`, `Result`, `ArchiveRecord`, `Person`, `Face`, `Annotation`, `Scene`, `SourceStatus`, `Viewer`) are in the `.d.ts` files.

## Build snippet
```jsx
const { SearchBar, ResultGrid, Panel, Tag, Button } = window.Mmindex;
function Console({ people, results }) {
  return (
    <div style={{ padding: 16, display: "grid", gap: 14 }}>
      <SearchBar people={people} onSearch={(p) => console.log(p.parsed)} />
      <ResultGrid results={results} query="Ana is cooking" people={people} />
      <Panel className="mm-row">
        <Tag tone="good">{results.length} hits</Tag>
        <Button variant="ghost">Export</Button>
      </Panel>
    </div>
  );
}
```
