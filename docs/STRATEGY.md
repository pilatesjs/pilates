# Strategy

This is the canonical answer to "what is Pilates and where is it going?"
It supersedes scattered framing in package READMEs and supersedes any
older roadmap-ish content elsewhere.

## What Pilates is

A flex layout engine purpose-built for the terminal — pure TypeScript,
zero runtime dependencies, validated cell-for-cell against a reference
WASM flexbox implementation — packaged so consumers can take just the
engine, just the painter, the diff loop, the React reconciler, or any
combination, **without dragging in the rest**.

The split into five focused packages is the product. Each can be used
standalone (or in combination):

| Package | Use case | Depends on |
|---|---|---|
| `@pilates/core` | Imperative `Node` API → integer cell layouts | nothing |
| `@pilates/render` | Declarative POJO tree → painted ANSI string | core |
| `@pilates/diff` | Frame-to-frame cell diff → minimal ANSI redraw | render (for `Frame`) |
| `@pilates/react` | React 19 reconciler driving the above | core, render, diff |
| `@pilates/widgets` | Interactive widgets (`TextInput`, `Select`, `Spinner`, etc.) | react |

## Goal

Become the most capable JavaScript TUI library — surpassing Ink, Yoga
(direct), and OpenTUI on capability and developer experience —
without giving up the architectural commitments that make Pilates
distinct (zero-dep, pure-TS, unbundled). "Lots of stars" is a stated
success metric: marketing / visibility / a flagship-app strategy is
co-equal with engineering, not an afterthought. Multi-quarter
commitment from a solo maintainer; pace accordingly.

This goal is a deliberate pivot from earlier "ship 1.0 quietly,
demand-driven beyond the core trio" framing. We compete on capability
and DX, not just architecture. Speculative-but-strategic capability
investment is in scope when it widens the gap.

## Where Pilates sits

In JavaScript / TypeScript, the React-for-terminals niche is dominated
by **Ink** (~3M weekly downloads, 7-year incumbent). Ink couples its
flex layout engine (Yoga, WASM) to its React reconciler — you can't
take one without the other. **OpenTUI** (10.7k stars, Bun + Zig,
drives [OpenCode](https://opencode.ai)) is the real momentum
competitor on the renderer side; it uses `yoga-layout` under the hood
for layout. Other JS options (`blessed`, `inquirer`, `vorpal`) serve
narrower niches.

Outside JS, the comparable libraries — Textual (Python), Ratatui
(Rust), Bubbletea (Go) — share the same general shape but different
language ecosystems entirely.

**Pilates' positioning is the unbundled, faster alternative to Ink in
the JS/TS niche.** Faster matters: Pilates beats WASM Yoga on every
benchmarked workload (see `bench/RESULTS.md` and the Performance
section of the root README), including the hot-relayout pattern Yoga
historically won on.

## What Pilates actually offers vs. Ink / Yoga / OpenTUI

The wedge is *decoupling + speed + scope*, not "better DX yet":

1. **Take just the layout.** Want flex layout under a non-React
   runtime (Vue, Solid, vanilla, custom DSL)? `@pilates/core` is
   0-dep TypeScript. Ink doesn't expose that path. OpenTUI doesn't
   expose layout standalone either.

2. **Faster than WASM Yoga at TUI tree sizes.** Pure-TS layout
   engine, no `WebAssembly.compile` startup cost, no JS↔WASM
   marshalling on every layout pass. Three perf phases shipped in
   2026-05 (measure-cache, layout-cache, relayout-boundaries) bring
   Pilates 7–12× faster than Yoga on tree-build-then-layout AND
   ~9× faster on the hot-relayout pattern (long-lived tree, mutate
   one leaf per frame) that Yoga had previously won. Validated
   cell-for-cell against Yoga across 33 oracle fixtures plus a
   500-runs/CI property-based fuzzer that compares cached vs.
   cold layouts on randomly-generated trees.

3. **Zero runtime deps.** Across the entire 5-package surface,
   `@pilates/core` ships with zero transitive runtime dependencies.
   `@pilates/react`'s only runtime dep is `react-reconciler`. Ink
   pulls in 30+ transitive deps via its WASM loader and supporting
   tooling.

4. **Tighter scope per package.** Single concern per package, easier
   to audit, easier to fork, smaller install footprint when you only
   need one piece.

What Pilates **doesn't** offer over Ink (yet):

- Bigger discovery footprint. Ink owns the search results, the
  tutorials, the Stack Overflow answers. We're working on that.
- More flagship app proof points. Ink has powered Cloudflare CLI,
  Vercel CLI, and many others for years. Pilates needs a flagship.
- 7-year battle-testing. Pilates is day-one; some bugs only surface
  with sustained real-world use.

## What Pilates deliberately doesn't do

- **No widgets in the engine or reconciler.** Widgets live in their
  own opt-in package, `@pilates/widgets`. The engine, render layer,
  and React reconciler don't carry them — you don't pay for widgets
  if you don't import the widgets package.
- **No animation primitives.** Terminal isn't a 60-fps medium.
- **No alt-screen / clipboard / kitty graphics protocol.** Stays in
  the scrollback, writes ANSI, exits cleanly. Mouse and scroll are
  in scope (shipped); these others are not unless the project's
  identity shifts.
- **No concurrent-mode React.** Terminal use case is genuinely
  unclear; the reconciler complexity isn't worth speculative gain.

## Roadmap

### Done (2026-04 → 2026-05)

Ordered roughly by ship date. All on npm; no public API breakages.

- **`useInput` (2026-05-01).** `@pilates/react@0.2.0` added a
  discriminated `KeyEvent` API + xterm-compatible key parser + lazy
  raw-mode lifecycle.
- **`@pilates/widgets@0.1.0-rc.1` (2026-04-30).** `<TextInput>`,
  `<Select>`, `<Spinner>` — the trio that closes the practical
  adoption gate ("how do I prompt for a string?").
- **v1 capability sprint (2026-05-05).** 11 PRs delivered Track 1's
  P0 + P1 + first P2 items: `<ProgressBar>`, `usePaste` (bracketed
  paste), `useFocus` / `useFocusManager` (full multi-input focus
  navigation), `aspectRatio` style prop, `<TextArea>`, `<MultiSelect>`,
  `<Tabs>`, `<ErrorBoundary>`, `<Table>`, theming primitive, and
  `useBoxMetrics`.
- **Error infrastructure Phase 1 (2026-05-06).** Typed `PilatesError`
  with code registry, dev-only hint table, `formatPilatesError`,
  `didYouMean` Levenshtein utility, `suggestHostTypeReplacement`.
- **`<ScrollView>` + overflow (2026-05-07).** `overflow` /
  `overflowX` / `overflowY` styles, full imperative scroll handle,
  controlled / uncontrolled modes, `onScroll` callback, keyboard
  navigation, `useScrollIntoFocus`.
- **Mouse support (2026-05-08).** `onClick` / `onWheel` on `<Box>`,
  `useMouse` hook, `<ScrollView>` wheel-scroll integration.
  Bubbling, `stopPropagation`, ref-counted enable/disable.
- **Perf hardening Phase 1 (2026-05-08).** 8-slot per-leaf measure
  cache (matches Yoga's `MaxCachedMeasurements`), all 5 measure-func
  call sites routed through `callMeasureFunc`, differential-mode
  validation harness (`PILATES_DIFFERENTIAL_LAYOUT=1` runs every
  layout twice and asserts cached == cold), property-based fuzzer
  (500 runs / CI), warn-only perf-budget CI workflow.
- **Perf hardening Phase 2 (2026-05-08).** 1-slot per-node layout
  cache wired into the root path, `snapshotForCache` /
  `restoreFromCache` helpers, hot-relayout bench scenario,
  perf-budget CI flipped to fail-on-regression. Phase 2 produced
  competitive numbers on identical-input replays but didn't help
  hot-relayout (root dirties on every mutation; layout cache only
  reads on root cache hits).
- **Perf hardening Phase 3 (2026-05-09).** Flutter-style relayout
  boundaries: a node with explicit `width` AND `height` AND default
  flex grow/shrink stops the upward `markDirty` propagation;
  `_hasDirtyDescendant` flag turns the root cache-hit path from
  O(N) to O(dirty subtree). **Pilates now beats WASM Yoga ~9× on
  hot-relayout** when consumers structure trees with explicit-sized
  containers (the idiomatic TUI pattern). Public API unchanged.

### Now (in flight)

- **Promote `@pilates/core` rc.2 → 1.0.0 and `@pilates/render`
  rc.3 → 1.0.0.** Three perf phases on top of rc.2 with no public
  API change is strong signal of API stability. Issue #11.
- **Bump `@pilates/diff` to 0.2.0** alongside the core / render
  promotion (no diff changes, version bump for consistency).
- **Bump `@pilates/widgets` to 0.2.0** (added in v1 capability
  sprint: ProgressBar, TextArea, MultiSelect, Tabs, Table; widgets
  gain `focusId` / `autoFocus`).

### Plausibly next (not committed)

Ranked by strategic alignment with the ambition pivot:

- **Flagship example app.** A real-world TUI built on Pilates that
  showcases the stack: scrolling list + form + dashboard, idiomatic
  React patterns, mouse, focus, theming, typed errors. Drives
  README screenshots and HN-launch material.
- **Marketing moment.** Phase 3 is the headline result; an HN
  /  blog post / Twitter announcement after 1.0.0 promotion is
  the natural visibility play.
- **API doc generation (typedoc).** Public-API docs site — Ink
  doesn't have one as polished as we could build. Aligns with
  "best DX" positioning.
- **Scaffolder CLI** (`npm create pilates@latest`). Time-to-first-app
  matters for adoption. Match the modern JS framework expectation.
- **Devtools.** A live tree inspector / layout debugger via DevTools
  protocol or a textual UI. Genuine differentiator vs Ink.
- **Error infrastructure Phase 2** (`<ErrorOverview>` panel
  full-screen takeover for unhandled errors during dev) — gated on
  Phase 1 baking with no SemVer regressions in consumer feedback.

These are evaluated as they come up; not commitments.

## Decision rules for new feature requests

When an issue or proposal arrives, evaluate against these gates:

1. **Does it require coupling layout to reconciler, or paint to
   layout?** If yes, decline — that violates the unbundling thesis.
2. **Could it live in a separate package without losing meaning?**
   If yes, it should — keep core packages small.
3. **Does it widen the gap vs Ink / OpenTUI on capability or DX?**
   The ambition pivot makes "yes" a strong signal in favor.
4. **Does it require WASM, native bindings, or a parser library?**
   Heavily skeptical — zero runtime deps is a real feature.
5. **Does it match Ink's API, or improve on it?** Match Ink for
   *names* (Box, Text, Spacer, useApp) where the names are obviously
   right. *Improve* on signatures where Ink's design is dated (e.g.
   `useInput`'s bag-of-booleans → discriminated event).

## Status of this document

Living. Update when the roadmap shifts or major capabilities ship.
Don't update when a single feature gets added or fixed — those
belong in `CHANGELOG.md`.

Last refresh: 2026-05-09 (post Phase 3 perf-hardening merge).
