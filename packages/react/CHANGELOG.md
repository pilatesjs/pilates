# Changelog

All notable changes to `@pilates/react` are documented here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

## [0.4.1] — 2026-05-23

Republished pinned against `@pilates/core@2.0.0`, `@pilates/render@1.0.2`,
and `@pilates/diff@0.2.1` so consumers of `@pilates/react` get the
phase 15–17 engine speedup transitively with a single de-duplicated
copy of each package in `node_modules`. No `@pilates/react` public API
change.

### Changed

- Pin `@pilates/core` dependency from `1.1.0` to `2.0.0`.
- Pin `@pilates/render` dependency from `1.0.1` to `1.0.2`.
- Pin `@pilates/diff` dependency from `0.2.0` to `0.2.1`.
- `VERSION` constant fixed from stale `0.2.1` to match `package.json`.

## [0.4.0] — 2026-05-20

### Layout devtools

First consumer of the `@pilates/core` `1.1.0` layout profiler API — an
in-TUI overlay that visualises which layout path each frame took and
how much incremental work it did. Useful for debugging perf-sensitive
TUIs and for confirming the Spineless incremental engine is on its
fast path in your tree.

- **Added** `useLayoutProfiler()` hook — returns
  `{ last: LayoutTrace | null; history: LayoutTrace[]; totals:
  Record<LayoutTrace['path'], number> }`. Subscribes via
  `setLayoutProfiler` on mount, unsubscribes on unmount. Ref-counted:
  multiple consumers share one subscription.
- **Added** `<LayoutDevtools>` component — an absolute-positioned
  overlay panel showing the current engine path, dirty/changed field
  counts, moved-subtree count, and a path-distribution sparkline of
  the last N traces. Self-sizing (the panel doesn't depend on parent
  flex distribution); place anywhere in your tree.
- **Added** `sparkline(values: number[], width?: number)` helper —
  reusable Unicode block-char sparkline for terminal contexts.
- **Added** Exports: `useLayoutProfiler`, `LayoutDevtools`,
  `LayoutDevtoolsProps`, `sparkline`.

Re-exports the `@pilates/core` profiler types (`LayoutTrace`,
`LayoutProfiler`) so consumers don't need a separate `@pilates/core`
import for typings.

### Dependency

- **Bumped** `@pilates/core` peer to `^1.1.0` (required for the layout
  profiler API).

## [0.3.0] — 2026-05-07

### Mouse support

- **Added** `onClick` / `onWheel` props on `<Box>` — deepest-first bubbling with `stopPropagation`.
- **Added** `useMouse(handler, options?)` hook for raw mouse events (button presses, releases, wheel ticks).
- **Added** SGR mouse encoding (`?1000h?1006h`) — automatically enabled/disabled as a ref-counted pair with raw mode.
- **Added** `<ScrollView>` responds to wheel events independently of `scrollEnabled` (keyboard nav flag). Nested `ScrollView`s isolate via `stopPropagation`.
- **Added** `sendMouseEvent` helper on `InputMountHandle` (test-utils) for integration testing.
- **Added** Exports: `useMouse`, `UseMouseOptions`, `MouseButton`, `MouseEvent`.

### Scrolling (Track 1 P2)

- **Added** `<ScrollView>` component — viewport into content larger than the visible area. Vertical by default; `horizontal` flips axis.
- **Added** Controlled (`scrollOffset`) and uncontrolled (`defaultScrollOffset`) scroll state, `onScroll(offset, meta)` callback, `stickToBottom` / `stickToTop` auto-scroll-to-edge semantics.
- **Added** Built-in keys (arrow / PgUp / PgDn / Home / End) when focused. `scrollEnabled={false}` disables.
- **Added** Imperative ref API: `scrollTo`, `scrollBy`, `scrollToStart`, `scrollToEnd`, `getScrollOffset`, `getContentSize`, `getViewportSize`.
- **Added** `useScrollIntoFocus(isFocused, boxRef)` — focusable descendants opt in to auto-scroll-when-focused. `scrollOnFocus={false}` disables.
- **Added** `overflow` / `overflowX` / `overflowY` props on `<Box>`. Values: `'visible' | 'hidden' | 'scroll' | 'auto'`.
- **Added** Re-exports: `ScrollView`, `ScrollViewProps`, `ScrollViewHandle`, `ScrollMeta`, `useScrollIntoFocus`, `FocusedBounds`, `ScrollContextValue`.

### Errors (new public surface)

- **Added** `PilatesError` class with `.code`, dev-only `.hint`,
  structured `.meta`, and `.componentStack` populated by the reconciler.
- **Added** `PilatesErrorCode` const object + derived type — stable string
  IDs (e.g. `PILATES_HOOK_OUTSIDE_RENDER`, `PILATES_UNKNOWN_HOST_TYPE`).
- **Added** `isPilatesError(e)` type guard — prefer over `instanceof` for
  cross-realm safety (pnpm hoisting / dual-publish).
- **Added** `formatPilatesError(err)` — multi-line formatter for terminal
  output (used by the default `<ErrorBoundary>` fallback). Guards against
  circular cause chains.
- **Added** `suggestHostTypeReplacement(type)` and the underlying
  `didYouMean(input, candidates)` utility — composes an HTML→Pilates
  mapping (`<div>` → `<Box>`, `<p>`/`<span>` → `<Text>`, etc.) with a
  TypeScript-style Levenshtein heuristic for typos.
- **Added** Did-you-mean for unknown JSX host types: `<div>` produces
  *"Pilates is not HTML; use `<Box>` instead"*; typos like `bxo` produce
  *"did you mean `Box`?"*.
- **Added** `componentStack` capture from `react-reconciler`'s `errorInfo`
  onto thrown `PilatesError`s — visible to consumer
  `<ErrorBoundary onError>` handlers, telemetry, and Phase 2's overlay.
- **Changed** All 16 framework throw sites now produce `PilatesError`s
  rather than plain `Error`. The `Pilates: ` prefix moved out of the raw
  `error.message` and into `formatPilatesError()` — user-visible output
  via the default fallback is unchanged. Existing tests asserting on
  payload substrings (e.g. `/must be used inside <render>/`) continue
  to pass; one internal test asserting on the literal `"Pilates:"` prefix
  in `error.message` was updated to match the new payload-only form.
- **Changed** Default `<ErrorBoundary>` fallback now branches on
  `isPilatesError`: PilatesErrors render as `Pilates: <message> (<hint>)`
  in dev, while non-Pilates errors keep the legacy `Render error: <message>`
  form.
- **SemVer**: `error.code`, `instanceof PilatesError` / `isPilatesError`,
  and structured field shapes are public API. `error.message` text and
  `error.hint` text are not — they may be reworded in any minor.
- **Source maps**: Pilates emits `.js.map`. Run with
  `node --enable-source-maps` for `.ts`-pointing stack traces. No runtime
  `source-map-support` patch is bundled (libs must not mutate
  `Error.prepareStackTrace`).
