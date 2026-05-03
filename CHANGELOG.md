# Changelog

All notable changes to Pilates are documented here. The format roughly follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
follows [Semantic Versioning](https://semver.org/) once it leaves the `1.0.0`
release-candidate train.

## Unreleased

Codebase-review batch (PR #23). Seven correctness / API-hygiene fixes across
four packages, surfaced by an internal review pass before the imminent
`@pilates/core@1.0.0` and `@pilates/render@1.0.0` promotions. All fixes ship
TDD with new failing-then-passing tests; workspace test count 429 → 446.

### Changed — `@pilates/core` (pre-1.0)

- `Node.style` is now exposed as `Readonly<Style>` and `Node.layout` as
  `Readonly<ComputedLayout>` on the public surface. External callers that
  used to mutate via `node.style.flexGrow = 99` (silently bypassing
  `markDirty()`) now fail typecheck. The supported path remains the
  `setX()` / `calculateLayout()` API, which is unchanged. Internal
  algorithm code reads via the readonly view and writes via the new
  `_style` / `_layout` backing fields.
- `pnpm typecheck` now uses a new `tsconfig.typecheck.json` that includes
  test files, so `@ts-expect-error` directives that document API contracts
  are validated.

### Fixed — `@pilates/render` (pre-1.0)

- `wrapText`: trailing whitespace is trimmed at wrap boundaries when a
  whitespace token fits on the current line but the next word forces a
  wrap. Indent-only lines and end-of-paragraph whitespace are still
  preserved (CSS `white-space: normal` parity).

### Fixed — `@pilates/react` (pre-1.0)

- Key parser: a bare `\x1b` at end-of-chunk is now returned as `remainder`
  instead of being emitted as `{ name: 'escape' }` immediately. Split-chunk
  CSI sequences (`\x1b` then `[A` in the next read) now reassemble into the
  correct arrow event instead of being parsed as `escape` plus literal `[A`.
- `StdinProvider` adds a 50 ms disambiguation timer that flushes a held
  bare ESC as a real Escape event when no follow-up byte arrives — matches
  xterm.js / ink. Standalone Escape still fires; the cleanup tears the
  timer down on unmount.
- `useInput(handler, { isActive: false })` no longer briefly enables raw
  mode during mount. `subscribe()` now takes an optional `initialActive`
  flag (back-compat default `true`) so the handler can register inactive
  without bumping the refcount.
- `mount()` test helper (from `@pilates/react/test-utils`) now wraps
  reconciler operations in `act()` and drains passive effects on initial
  mount, `setState`, and `unmount`. Components with `useEffect` that
  schedule state updates now settle before `lastWrite()` returns. Mirrors
  the existing `mountWithInput()` behavior.

### Fixed — `@pilates/widgets` (pre-1.0)

- `<TextInput>` cursor model is now grapheme-cluster indexed instead of
  UTF-16 code unit indexed. Backspace, left/right arrows, home/end,
  Ctrl+U / Ctrl+K / Ctrl+W, character insertion, placeholder rendering,
  and cursor-split rendering all walk graphemes via `graphemes()` from
  `@pilates/core`. Emoji and ZWJ sequences (e.g. 👨‍👩‍👧) edit as one
  user-perceived character; surrogate pairs no longer split mid-edit.
  The `mask` prop validates as a single grapheme rather than a single
  code unit.
- `<Select>` re-clamps `highlightIndex` when the `items` prop shrinks past
  the current index. Previously, Enter became a silent no-op and no row
  showed as highlighted after the items list shrank.

### Added — `@pilates/widgets`

- New runtime dependency on `@pilates/core` (workspace) for grapheme
  segmentation in `<TextInput>`. `@pilates/core` was already a transitive
  dep via `@pilates/react`; this just makes the direct relationship
  explicit so the widgets package can `import { graphemes } from
  '@pilates/core'`.

## 2026-05-01 — `@pilates/react@0.2.0`

### Added

- `useInput` hook for keystroke handling. Discriminated `KeyEvent` shape:
  `{ name?, ch?, ctrl, alt, shift, sequence }`. Broadcast delivery to
  every active subscriber; `isActive: false` opts a handler out without
  affecting the raw-mode lifecycle.
- `KeyEvent`, `KeyName`, `UseInputOptions` exported types.
- xterm-compatible key parser (`packages/react/src/key-parser.ts`):
  arrow keys, F1–F12, page nav, home/end, delete, ctrl+letter,
  alt+letter, CSI modifier params for arrows and tilde keys, multi-byte
  UTF-8 passthrough, partial-sequence remainder for chunked stdin.
- Lazy raw-mode lifecycle: `process.stdin` is untouched unless at least
  one `useInput` is mounted; raw mode is entered on the first mount,
  exited on the last unmount, and survives `setRawMode` failures.
- New `stdin?: NodeJS.ReadStream` option on `render()` for tests + scripted
  input.

### Deferred

- Bracketed paste mode, Kitty keyboard protocol — v0.3 if requested.
- `useFocus` / `useFocusManager` — Phase 3 of the post-1.0 roadmap.
- Mouse events — permanently out of scope per `docs/STRATEGY.md`.

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
