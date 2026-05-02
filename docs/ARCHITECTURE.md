# Architecture

This document explains how Pilates is organized internally — what each
package does, how the flex algorithm runs, how text measurement works,
and how the engine is validated. It's aimed at contributors and at users
deciding whether the design holds up for their use case.

## The five packages

Pilates ships as five focused packages that compose:

```
@pilates/core      layout engine        →  ComputedLayout per node
@pilates/render    out-of-box paint     →  ANSI string
@pilates/diff      incremental redraw   →  ANSI escape stream
@pilates/react     React reconciler     →  JSX/hooks → ContainerNode tree
@pilates/widgets   interactive widgets  →  TextInput, Select, Spinner
```

The first three (`core` / `render` / `diff`) form the imperative core.
Each depends only on the package(s) before it. A consumer that wants
just the layout output can use `@pilates/core` alone. A consumer that
wants strings printed to stdout uses `@pilates/render`. A consumer
driving live updates over an existing terminal uses `@pilates/diff`
on top of `renderToFrame()`.

The last two (`react` / `widgets`) sit on top of that core for users
who want to author terminal UIs with JSX and hooks. `@pilates/react`
provides a custom `react-reconciler` host config whose host instances
are `@pilates/render`'s `ContainerNode` / `TextNode`, plus
`useInput` for keyboard input. `@pilates/widgets` ships interactive
primitives (`TextInput`, `Select`, `Spinner`) built on top.

The split exists because **layout, painting, incremental redraw, and
the reconciler are genuinely separable concerns**. Coupling them — the
way Ink couples flex layout to React's reconciler — means consumers
without that exact runtime have to reimplement the whole stack.
Pilates' boundary is the `Frame` (a 2D cell grid): anything that can
produce a Frame can drive any of the lower three packages, and React
is purely opt-in.

## The flex algorithm

`@pilates/core` implements a subset of CSS Flexbox sized for terminal
grids. The full pipeline lives in
[`packages/core/src/algorithm/index.ts`](../packages/core/src/algorithm/index.ts):

```ts
calculateLayout(root, availableWidth, availableHeight)
  → resolveRootAxisSize(...)     // root's own size
  → layoutChildren(root)         // recurse
  → roundLayout(root)            // float → integer cells
  → markClean(root)
```

`layoutChildren` runs in three logical passes per node:

1. **Sizing**. Resolve the node's content-area dimensions from style
   (width/height/min/max) and flex parameters. For flex children,
   compute the hypothetical main-axis size from `flexBasis` (or the
   intrinsic content size when `flexBasis: 'auto'`).
2. **Main-axis distribution**. Walk children, assign main-axis sizes.
   Run the **CSS freeze loop** to handle min/max constraint violations:
   if any child would shrink past its minimum or grow past its maximum,
   freeze it at that bound and redistribute the slack across the rest.
   Repeat until stable. Apply `justifyContent` to position the line.
3. **Cross-axis distribution**. For each child, resolve cross-axis size
   (stretch by default) and apply `alignItems` / `alignSelf`. For
   wrapped containers, accumulate lines and run `alignContent` over
   them. Source: [`main-axis.ts`](../packages/core/src/algorithm/main-axis.ts).

Absolute children (`positionType: 'absolute'`) are laid out separately
after the flow children have settled. Their offsets are relative to the
parent's **outer** box (the box including padding) — this matches Yoga
and React Native semantics, *not* CSS, where absolute children measure
from the padding edge. The choice keeps consumers porting from
Ink/RN consistent with their existing mental model. See
[`packages/core/src/algorithm/absolute.test.ts:155`](../packages/core/src/algorithm/absolute.test.ts) for
the test that pins this down.

### Integer rounding

Terminal cells are integers. The algorithm computes in floating-point
and runs a final integer-rounding pass that **rounds the absolute
position of each corner** of every node, then derives the size from
the rounded edges:

```
size = round(left + width) − round(left)
```

This is what makes `[100, flex:1, flex:1, flex:1]` lay out cleanly as
`[34, 33, 33]` instead of `[33, 33, 33]` with a 1-cell gap on the right
— the rounding error is absorbed into the largest sibling rather than
dropped on the floor. Source:
[`packages/core/src/algorithm/round.ts`](../packages/core/src/algorithm/round.ts).

### What v1 explicitly omits

By design, v1 does not implement: `aspectRatio`, RTL/LTR direction
inheritance, baseline alignment, style inheritance, scroll containers,
animations, or input handling. These are tracked for future versions.
The deferrals are documented inline (see e.g.
[`packages/core/src/style.ts:5`](../packages/core/src/style.ts) and
[`packages/core/src/algorithm/main-axis.ts:657`](../packages/core/src/algorithm/main-axis.ts)).

## Text measurement

Terminal layout is wrong if text measurement is wrong. A latin-script
character is one cell; a CJK ideograph is two; an ANSI escape is zero;
an emoji ZWJ family (👨‍👩‍👧) is one grapheme spanning two cells. Get any of
those wrong and text either overflows its box or leaves gaps.

`@pilates/core` ships its own measurement primitives in
[`packages/core/src/measure/`](../packages/core/src/measure/):

- **`stringWidth(s)`** — total cell width of a string (ANSI-aware,
  grapheme-aware)
- **`cellWidth(cp)`** — cell width of a single codepoint
- **`graphemes(s)`** — split into grapheme clusters (extended cluster
  algorithm: ZWJ joiners, regional indicator pairs, emoji modifiers)
- **`stripAnsi(s)`** — remove SGR/CSI escape sequences

The width tables are generated at build time from the latest Unicode
UCD data — East Asian Width, Emoji Presentation, Grapheme Break
Property, Default Ignorable. The generator lives in
[`tools/generate-unicode-tables.ts`](../tools/generate-unicode-tables.ts);
the output sits in
[`packages/core/src/measure/tables.ts`](../packages/core/src/measure/tables.ts).
There is no runtime fetch and no Unicode data ships separately — the
tables are inlined into the package and bundled with consumers.

## Why headless

"Headless" means **the engine returns coordinates, not pixels (or
cells)**. Calling `node.getComputedLayout()` gives you a
`{ left, top, width, height }` rectangle in integer cells. What you do
with that rectangle — paint a string, fill a framebuffer, snapshot for
a test, draw on a canvas — is your choice.

This boundary makes Pilates portable in a way coupled engines aren't:

- **Any JS runtime**. Pure TypeScript, zero runtime dependencies.
  Works in Node, Bun, Deno, the browser, edge runtimes, anything that
  speaks ES modules.
- **Any output**. The included `@pilates/render` is one painter; you
  can write your own that emits HTML cells, PNG snapshots, accessible
  SVG, or whatever. Snapshot tests typically use
  `frame.toPlainString()` (no ANSI) for deterministic assertion.
- **Composable**. `@pilates/diff` consumes Frames the same way
  `@pilates/render` does — they share a contract, not an implementation.

The cost of headlessness is that simple cases need two packages
(`core` + `render`) rather than one. The benefit is that complex
cases — testing, alternative renderers, non-Node runtimes — are
reachable without forking.

## Validation

Layout is the load-bearing concern. Bugs are subtle and hard to spot:
a missing 1-cell margin on a 50-cell container looks fine until a child
overflows by exactly one cell, off-screen, and becomes invisible.
Pilates uses two complementary validation strategies.

**Cross-implementation oracle (30 fixtures).** The flex algorithm is
checked cell-for-cell against a reference WASM flexbox implementation.
For each fixture, the same node tree is built in both engines, both
compute the layout, and the integer-rounded `{ left, top, width, height }`
of every node must match exactly. Source:
[`packages/core/test/yoga-oracle.test.ts`](../packages/core/test/yoga-oracle.test.ts).
Coverage spans fixed widths, flex distributions, padding, margin, gap,
min/max constraints, every value of `justifyContent` / `alignItems` /
`alignSelf` / `alignContent`, `flexWrap` (both directions), and every
absolute-positioning anchor (top, right, bottom, left, paired).

**Unicode width fuzzer.** Text measurement is checked against
`@xterm/headless` (the same library running in VS Code's terminal).
Each CI run generates 200 randomized strings from a "safe" codepoint
set, feeds them through both `stringWidth()` and `xterm`'s cursor
position calculation, and asserts agreement. Source:
[`packages/core/test/xterm-fuzz.test.ts`](../packages/core/test/xterm-fuzz.test.ts).

The combination — algorithm validated against a reference
implementation, text measurement validated against a real terminal —
covers the two surfaces where layout silently goes wrong.

## File map

```
packages/core/src/
  index.ts                  public exports
  node.ts                   the Node class (mutable tree)
  edge.ts                   Top/Right/Bottom/Left/Horizontal/Vertical/All
  style.ts                  Style interface + defaults
  layout.ts                 ComputedLayout type
  measure-func.ts           MeasureFunc callback for content-sized leaves
  algorithm/
    index.ts                calculateLayout() entry point
    main-axis.ts            sizing + main + cross axis passes (the core)
    axis.ts                 axis abstraction (row/column maps to main/cross)
    absolute.ts             absolute children pass
    round.ts                float → integer cells
  measure/
    index.ts                public exports
    width.ts                cellWidth, stringWidth
    grapheme.ts             grapheme cluster boundary detection
    ansi.ts                 stripAnsi
    range-search.ts         binary-search lookup over UCD ranges
    tables.ts               generated UCD tables (Unicode 16)

packages/render/src/
  index.ts                  public exports
  render.ts                 render() / renderToFrame()
  build.ts                  declarative tree → core Node tree
  painter.ts                Frame ← layout (ANSI emission)
  frame.ts                  2D cell grid with toString()
  borders.ts                box-drawing characters per style
  wrap.ts                   text wrapping (word + grapheme fallback)
  ansi.ts                   SGR helpers (fgSgr, bgSgr, attrsSgr, sgr)
  types.ts                  RenderNode / TextNode / ContainerNode

packages/diff/src/
  index.ts                  public exports
  diff.ts                   compute minimal CellChange[]
  apply.ts                  encode CellChange[] as ANSI escape string
  types.ts                  CellChange interface

packages/react/src/
  index.ts                  public exports (Box, Text, render, useInput, ...)
  components.tsx            Box / Text / Spacer / Newline JSX components
  reconciler.ts             HostInstance + RootContainer types
  host-config.ts            react-reconciler HostConfig (mutation mode)
  render.tsx                render() entry — providers + sync flush + diff
  hooks.ts                  useApp / useStdout / useStderr / useInput
  key-parser.ts             ESC-sequence parser for keypress events
  text-flatten.ts           nested <Text> → string for TextNode.text
  test-utils.ts             mount() / mountWithInput() for tests

packages/widgets/src/
  index.ts                  public exports
  text-input.tsx            single-line input with cursor + placeholder
  select.tsx                arrow-key list selector with focus / disable
  spinner.tsx               interval-driven frame animator
  spinner-frames.ts         curated frame sets (dots, line, ...)
```

## Further reading

- [Root README](../README.md) — what Pilates is, quick start, examples
- [`packages/core/README.md`](../packages/core/README.md) — engine API
- [`packages/render/README.md`](../packages/render/README.md) — renderer API
- [`packages/diff/README.md`](../packages/diff/README.md) — diff/apply API
- [`packages/react/README.md`](../packages/react/README.md) — React reconciler API
- [`packages/widgets/README.md`](../packages/widgets/README.md) — interactive widgets
- [`CONTRIBUTING.md`](../CONTRIBUTING.md) — how to make changes that survive review
