# Changelog

All notable changes to Pilates are documented here. The format roughly follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
follows [Semantic Versioning](https://semver.org/) once it leaves the `1.0.0`
release-candidate train.

## Unreleased

Pending — will land with the `@pilates/core@1.0.0` and `@pilates/render@1.0.0`
promotions at end of bake (~2026-05-13). Source on `main` since PR #23.

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

### Added — `@pilates/core` (pre-1.0)

- `setAspectRatio(value: number | undefined)` and `style.aspectRatio` —
  CSS `aspect-ratio` (width / height). When set and exactly one of
  `width` / `height` is a number (the other being `'auto'`), the auto
  axis is derived as `set / aspectRatio` (height) or `set * aspectRatio`
  (width). Both axes explicit ⇒ ratio is ignored. Min/max clamps still
  apply on each axis after derivation. Honored by root sizing, flex
  hypothetical / natural sizes, and the cross-stretch path so an
  aspect-ratio-derived cross beats the default `align-items: stretch`.
  `<Box aspectRatio={...} />` (via `@pilates/render`'s `LayoutProps`)
  exposes the same prop to declarative consumers.

### Fixed — `@pilates/render` (pre-1.0)

- `wrapText`: trailing whitespace is trimmed at wrap boundaries when a
  whitespace token fits on the current line but the next word forces a
  wrap. Indent-only lines and end-of-paragraph whitespace are still
  preserved (CSS `white-space: normal` parity).

### Added — `@pilates/react` (next minor)

- `useWindowSize()` — convenience hook returning `{ columns, rows }`,
  re-rendering on terminal resize. Equivalent to picking those fields
  off `useStdout()`; offered for parity with the name peer libraries
  use.
- `snapshot(out)` exported from `@pilates/react/test-utils`. Returns
  `{ ansi, plain }` for two-shot snapshot testing — one form catches
  color / cursor drift, the other catches layout drift. Strips CSI
  inline (no `strip-ansi` runtime dep). The widgets package's
  internal `snap()` / `strip()` helpers are now thin re-exports of
  this.
- `useBoxMetrics(ref)` — reads the most recent computed layout
  (`{ left, top, width, height }`) of a `<Box>` referenced by `ref`.
  Returns `null` until the ref attaches and the first layout pass
  completes. Re-renders on SIGWINCH (via shared `useStdout` dep) and
  whenever a commit produces a different layout for this Box; the
  internal layout-key check prevents the hook from looping. `<Box>`
  and `<Text>` now accept `ref?: Ref<unknown>` (Ink v7 parity).

### Fixed — `@pilates/react` (pre-1.0)

- `commitUpdate` was reading the **oldProps** position instead of
  newProps under react-reconciler@0.31. The @types/react-reconciler@0.28.9
  signature shifts every arg one slot left from the runtime, and the
  type-shim cast picked up `oldProps` while believing it was `newProps`.
  Result: any prop change on a `<Box>` that affected layout (`width`,
  `height`, `flex*`, padding, margin, etc.) was silently ignored — only
  Text-content updates worked because they go through `commitTextUpdate`
  on a separate path. The fix uses positional args via a typed cast so
  the runtime arg at index 3 (newProps) lands correctly. No existing
  tests caught this because none changed Box layout props at runtime;
  caught while building `useBoxMetrics`. Two snapshots updated to the
  correct (now-fully-redrawn) deltas.

### Changed — `@pilates/render` (pre-1.0)

- `renderToFrame` now mirrors each computed `{ left, top, width, height }`
  back onto the source `RenderNode` as `node._layout`. This lets the
  React layer expose `useBoxMetrics(ref)` without re-running layout from
  user-land. Mutating the input tree is acceptable because
  `renderToFrame`'s contract is "compute layout + return a Frame" — the
  layout property is an observable side-effect, never an input.
  `ComputedLayout` is a new exported type.

- `<ThemeProvider>` + `useTheme()` + `defaultTheme` / `lightTheme` —
  semantic color-token theming. Tight v1 token set: `primary`, `accent`,
  `text`, `muted`, `success`, `warning`, `error`, `info`, `border`.
  `<ThemeProvider>` accepts a full `Theme` or `Partial<Theme>`; partial
  overrides merge on top of the parent (or `defaultTheme` when no parent
  provider is present), and nested providers compose the same way.
  `useTheme()` is opt-in — calling it outside any provider returns
  `defaultTheme` instead of throwing, so simple apps can adopt theming
  incrementally without restructuring. Built-in widgets in
  `@pilates/widgets` are NOT theme-aware in this minor (would change
  visible defaults / break existing snapshots) — that opt-in lands in a
  follow-up.
- `<ErrorBoundary>` — catches render-phase throws in its subtree and
  renders a fallback instead of crashing the whole tree. Default fallback
  is a single bold-red line `Render error: <message>` sized to fit any
  viewport; consumers can pass a custom `fallback` (static `ReactNode` or
  `(error, reset) => ReactNode`). `onError(error, info)` for logging /
  telemetry; `resetKeys` clears the caught error when any array element
  changes by `!==`. The class component implementation uses React's
  built-in `getDerivedStateFromError` / `componentDidCatch` contract,
  which means async errors and event-handler throws still bypass it
  (the standard React boundary limitation). Sibling subtrees outside
  the boundary continue rendering normally.
- Internal: `createContainer` now wires `onCaughtError` and
  `onRecoverableError` (react-reconciler@0.31's signature). The previous
  8-arg call worked for happy paths but crashed inside React's
  `logCaughtError` whenever an `<ErrorBoundary>` actually caught — the
  bug stayed latent because no test exercised the boundary path until now.
- `usePaste(handler)` — subscribes to xterm bracketed-paste payloads
  (DEC mode 2004). The handler receives the entire pasted text as one
  string (newlines / control bytes preserved), never as a flood of
  keystroke events through `useInput` — so a multi-line paste no
  longer fires Enter on every newline. The hook activates raw mode on
  its own, so a paste-only app works without an additional `useInput`.
  `render()` writes `\x1b[?2004h` on raw-mode entry and `\x1b[?2004l`
  on exit, gated on the same TTY check that gates raw mode.
- `useFocus({ id?, autoFocus?, isActive? }) → { isFocused, focus, blur, id }`
  and `useFocusManager() → { focusedId, focus, focusNext, focusPrevious,
  enableFocus, disableFocus, isEnabled }` — focus management with Tab /
  Shift+Tab cycling. A `<FocusProvider>` is auto-installed by `render()`
  (opt out with `render(elem, { focus: false })`); it owns the Tab
  listener via its own `useInput`, so cycling works even with no user
  input handlers. Cycle order is mount order (explicit `order` deferred
  to v0.4); `autoFocus` is first-wins-in-commit-order so two siblings
  mounting in the same commit can't both steal focus. `id` defaults to
  `useId()` so per-call-site stability survives parent re-renders.
  `manager.focus("nope")` for an unknown id throws in dev, warns in
  prod. `<FocusProvider blurOnEscape>` (opt-in) clears focus on Esc.
- `key-parser`: `\x1b[Z` (xterm BackTab) now decodes to
  `{ name: 'tab', shift: true }`, so user `useInput` handlers and the
  internal focus-cycle listener can both treat Shift+Tab uniformly.

### Added — `@pilates/widgets` (next minor)

- `<ProgressBar>` — determinate or indeterminate progress bar.
  Determinate clamps `value` to `[0, total]` and rounds to a cell
  count; indeterminate animates a bouncing scanner of `scannerWidth`
  cells across the bar at `interval` ms. Custom `fillChar` /
  `emptyChar` and `color` / `trackColor` are supported. Built from
  sibling `<Text>` spans (no nested-Text style inheritance needed).
- `<TextInput>` consumes bracketed paste via `usePaste` — pasted text
  inserts at the cursor as a single `onChange` call. CR / LF inside
  the payload are stripped (single-line input); `<TextArea>` will
  preserve them. Emoji / ZWJ clusters in the paste survive intact via
  the existing grapheme-aware cursor model.
- `<TextInput>` and `<Select>` accept `focusId?: string` and
  `autoFocus?: boolean`. When `focusId` is set, the keystroke gate
  routes through the surrounding `<FocusProvider>` — Tab / Shift+Tab
  cycling moves between widgets without parent-side `focus={...}`
  bookkeeping. The boolean `focus` prop still works (back-compat) and
  is silently ignored when `focusId` is set.
- `<TextArea>` — multi-line text editor. Grapheme-aware 1-D cursor that
  walks across line boundaries; Enter inserts `\n`; `↑`/`↓` move
  between lines at preserved column (clamped to line length);
  `Home`/`End` are line-relative; backspace at column 0 joins with the
  previous line, delete at end-of-line joins with the next. Bracketed
  paste preserves newlines (unlike `<TextInput>`). Auto-grows
  vertically with content; word-wrap inside lines and fixed-height
  scrolling viewports are deferred to v2. Same `focus` / `focusId` /
  `autoFocus` props as `<TextInput>`.
- `<MultiSelect>` — checklist sibling of `<Select>`. Reuses `SelectItem`,
  the same `↑`/`↓`/`Home`/`End` highlight navigation, and the same
  `disabled` / focus props. Controlled via `selectedKeys: Set<string>`
  + `onChange(next: Set<string>)`; `Space` toggles the highlighted
  item, `Enter` calls `onSubmit` with the selected items in items-order.
  Default 4-cell prefix combines a cursor column (`❯ ` / `  `) with a
  checkbox column (`☑ ` / `☐ `); custom `indicator` function receives
  `{ isHighlighted, isSelected, isDisabled }`.
- `<Tabs>` — horizontal tab strip. Controlled via `activeKey` /
  `onChange(key)`; `←`/`→` cycle through enabled tabs (wrap-around,
  skip `disabled`), `Home`/`End` jump to first / last enabled. Activation
  is immediate (no separate highlight + commit step). Renders only the
  strip — consumers wire panel bodies based on the active key. Active
  tab renders `[Label]` in cyan + bold, inactive ` Label `, disabled
  dim. Same `focus` / `focusId` / `autoFocus` props as the other
  widgets. Stale `activeKey` (no matching item) recovers on the next
  arrow press by jumping to first / last enabled.
- `<Table>` — tabular data display. Bold header row, horizontal `─`
  divider, then one row per record. Per-column `width` (cells) /
  `align` (`'left'` | `'right'` | `'center'`) / optional `render`
  function for custom cell text. Values exceeding the column width
  truncate to `width − 1` cells with a trailing `…`; wide-character
  values (CJK / emoji) are measured via `stringWidth` from
  `@pilates/core` so truncation never overshoots a wide grapheme.
  Columns without `width` flex (16-cell fallback in v1; constrain
  with a parent `<Box width=…>`). Out of v1: vertical separators,
  wrapped multi-line cells, per-row selection, sorting / filtering.

## 2026-05-03 — `@pilates/react@0.2.2` + `@pilates/widgets@0.1.0-rc.2`

Codebase-review fixes (from PR #23) carried into the active bake. No API
breaks. Workspace test count 429 → 446.

### Fixed — `@pilates/react` 0.2.2

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

### Fixed — `@pilates/widgets` 0.1.0-rc.2

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

### Added — `@pilates/widgets` 0.1.0-rc.2

- New runtime dependency on `@pilates/core` for grapheme segmentation in
  `<TextInput>`. `@pilates/core` was already a transitive dep via
  `@pilates/react`; this just makes the direct relationship explicit so
  the widgets package can `import { graphemes } from '@pilates/core'`.

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
