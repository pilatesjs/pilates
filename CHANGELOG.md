# Changelog

All notable changes to Pilates are documented here. The format roughly follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
follows [Semantic Versioning](https://semver.org/) once it leaves the `1.0.0`
release-candidate train.

## 2026-04-30 — `@pilates/react@0.1.0-rc.1`

Initial pre-release of the React reconciler. Published with the `next`
dist-tag — `npm install @pilates/react@next`.

- React reconciler driving `@pilates/core` + `@pilates/render` + `@pilates/diff`
- Components: `Box`, `Text`, `Spacer`, `Newline`
- Hooks: `useApp`, `useStdout`, `useStderr` (read-only, `exit()` on `useApp`)
- `render(<App />, options?)` returns `{ unmount, waitUntilExit }`
- Auto-resize via SIGWINCH; full repaint on resize, incremental redraws otherwise
- `react@^19` peer; `react-reconciler@^0.31`

## 2026-04-29 — `@pilates/render@1.0.0-rc.2` + `@pilates/diff@0.1.0`

### Added — `@pilates/render` 1.0.0-rc.2

Additive — no breaking changes. Re-exports the low-level cell + SGR
primitives from the public surface so downstream packages (e.g.
`@pilates/diff`) can produce byte-for-byte matching ANSI without
reimplementing them:

- Types: `Cell`, `CellStyle`, `Rect`, `Attr`
- SGR helpers: `SGR_RESET`, `attrsSgr`, `bgSgr`, `fgSgr`, `packAttrs`,
  `sgr`

### Added — `@pilates/diff` 0.1.0 (initial release)

Cell-level frame diffing + minimal ANSI redraw sequences for live
Pilates TUIs. Pair with `renderToFrame()` from `@pilates/render` to
drive incremental redraws.

- `diff(prev, next)` — minimal set of cell-level updates between two
  `Frame`s. Full repaint when `prev` is `null` or dimensions differ;
  cell-level otherwise. Wide-character continuation slots (width 0)
  are never emitted directly — the leader handles them.
- `applyDiff(changes)` — encode a `CellChange[]` as one ANSI escape
  string ready for stdout: CSI cursor-position (1-indexed) + SGR + char
  per change. Style state tracked across the run; styles re-emit only
  when they change. Trailing reset emitted only when needed.
- 29 unit tests across `diff` (13) and `applyDiff` (16).

---

## [1.0.0-rc.1] — 2026-04-29

First public release candidate. Both packages published to npm under the
`@pilates` scope with public access.

### Added — `@pilates/core`

- Imperative `Node` API (create, insertChild, removeChild, calculateLayout,
  getComputedLayout, etc.).
- Full v1 flex algorithm: `flexDirection` (row, column, both reverses),
  `flex` / `flexGrow` / `flexShrink` / `flexBasis` with the CSS freeze loop,
  `width` / `height` / `minWidth` / `minHeight` / `maxWidth` / `maxHeight`,
  `padding` / `margin` / `gap` (row + column independent), `flexWrap`
  (`nowrap` / `wrap` / `wrap-reverse`).
- All alignment values: `justifyContent` (6 values), `alignItems` /
  `alignSelf` / `alignContent` (auto, flex-start, flex-end, center, stretch,
  space-between, space-around).
- Absolute positioning via `positionType: 'absolute'` and `position` per
  edge — React Native semantics (offsets relative to parent's outer box,
  not its content edge).
- Terminal-correct text measurement: `cellWidth(cp)` / `stringWidth(s)` /
  `graphemes(s)` / `stripAnsi(s)`, driven by Unicode UCD tables generated
  at build time (East Asian Width, Emoji Presentation, Grapheme Break
  Property, Default Ignorable). Handles CJK / emoji / VS16 / ZWJ families /
  regional indicator pairs.
- Integer-cell rounding pass: rounds absolute corners and derives size
  from rounded edges so sibling boxes butt cleanly under uneven splits.
- `MeasureFunc` callback for leaf nodes whose intrinsic size depends on
  content (e.g. wrapped text).
- Zero runtime dependencies. Pure TypeScript.

### Added — `@pilates/render`

- Declarative `RenderNode` tree → painted ANSI string via `render(tree)`.
- Five border styles (`single`, `double`, `rounded`, `bold`, `none`) with
  inline title slot (`┌─ Title ─...─┐`).
- ANSI styling: `color`, `bgColor`, `bold`, `italic`, `underline`, `dim`,
  `inverse`. Three color formats (named 16-color, hex `#rrggbb`, 256-color
  numeric).
- Text wrap modes: `wrap` (word-boundary + grapheme fallback), `truncate`
  (with `…` suffix), `none`.
- TTY detection: ANSI auto-stripped when stdout is not a TTY.
- `renderToFrame(tree)` returns the underlying `Frame` (2D cell grid) for
  consumers who want to drive diff-based redraws or run snapshot tests.
- Only runtime dependency: `@pilates/core`.

### Validation

- 200 tests across unit, algorithm, render-snapshot, and Unicode-fuzzer
  layers.
- 30 cell-for-cell oracle fixtures matched against a reference WASM
  flexbox implementation.
- 200 randomized strings per CI run validated against `@xterm/headless`
  for cell-width correctness.

### Notes on naming history

Project codename rotated through `tercli` → `barre` → `barrejs` → **Pilates**
during the open-source naming search. npm's name-similarity policy blocked
bare-name publication of `barre` (vs `base`/`dagre`) and `pilates` (vs
`pirates`); both are reserved by that policy against squatters as well, so
the supported install path is the scoped form: `@pilates/core` and
`@pilates/render`.
