# `<ScrollView>` design — Pilates v1 (Track 1 P2)

**Status:** spec draft, 2026-05-06
**Author:** Pilates project (`@pilates/react@0.5.0` target)
**Phase plan:** Track 1 P2 — the largest remaining v1 capability gap.
**Budget:** ~40 hours across `@pilates/core`, `@pilates/render`, `@pilates/react`, `@pilates/widgets`.

## Goal

Land a `<ScrollView>` primitive that lets a Pilates app render a viewport into content larger than the visible area, with built-in keyboard scrolling, focus integration, and a stick-to-edge auto-scroll mode for log buffers. Underpin it with a CSS-style `overflow` property in `@pilates/core` and a scissor-rect clipping stack in `@pilates/render`, so any future feature (virtualization, mouse wheel, scrollbar styles) layers on a sound foundation rather than re-implementing the basics.

## Non-goals

- Both-axis scrolling in the same component (single-axis switch only; both axes deferred to v1.1).
- Mouse wheel input (handled by the separate Track 1 mouse item; the renderer needs `overflow` first).
- Animated scroll (`scrollTo` jumps; RN-style easing/duration deferred indefinitely — terminal redraw budget is too tight).
- Virtualization (separate `<VirtualList>` widget post-v1; the scrollable viewport architecture must not bake assumptions about it).
- `overflow: clip`, scroll-snap, scroll-padding (post-v1; ratatui's `scroll_padding` is the most defensible later addition).
- Pull-to-refresh, momentum, bouncing, sticky headers, multi-pane sync, percentage scroll API (`setScrollPerc`).

## Background — research summary

Six libraries surveyed in depth (Ink, OpenTUI, Textual, ratatui, blessed, notcurses) plus Yoga's `Overflow` enum, React Native ScrollView, and react-window-class virtualizers. Findings drive every architectural choice below; full citations at the end.

| Library | Overflow lives | Scroll lives | Scrollbar | Verdict |
|---|---|---|---|---|
| Ink | nowhere | nowhere | nowhere | open issue since 2019, three competing community packages |
| OpenTUI | renderable level | `scrollbox` component | text glyphs | closest prior art; 5-bucket style API is the wart |
| Textual | CSS `overflow` style | per-widget `scroll_*` methods | text glyphs | the gold standard for CSS fidelity |
| ratatui | per-widget state | per-widget state | separate `Scrollbar` widget | RFC #174 unresolved at year 3 — fragmented model |
| blessed | `Box` option | `scroll(offset)` etc. | always-on or styled | battle-tested; `Log` separation is correct |
| notcurses | n/a | append-and-shift only | n/a | different model; not applicable |

**Yoga's `Overflow` is advisory.** Yoga issue #1804 (March 2025) confirms the layout engine doesn't enforce clipping or scrolling — those happen at paint time in the consuming framework (RN's UIScrollView, etc.). Pilates inherits the same constraint: clipping and scroll math live in `@pilates/render` and `@pilates/react`; core just owns the property bag.

**Convergent shape across mature TUIs:** CSS-level `overflow` style in the layout layer + scissor-rect clipping in the renderer + thin component wrapper exposing controlled/uncontrolled scroll state and an imperative ref API. Ink's ecosystem reinvents the same architecture in user-space three times; Textual and OpenTUI both ship it natively. This spec adopts that architecture.

## Architecture

Three layers, one per package, with deliberately narrow boundaries.

### Layer 1: `@pilates/core` — `overflow` style + scroll offsets

**`Style.overflow` additions:**

```ts
type Overflow = 'visible' | 'hidden' | 'scroll' | 'auto';

interface Style {
  overflow?: Overflow;
  overflowX?: Overflow;
  overflowY?: Overflow;
  // ... existing ...
}
```

Resolution rule (matches CSS): if `overflowX` or `overflowY` is set, it wins over `overflow` for that axis. `overflow` shorthand sets both.

`'visible'` is the default. In a cell-grid renderer, `'visible'` would corrupt sibling cells, so the renderer treats `'visible'` as `'hidden'` at paint time and emits a one-time dev-mode warning per node when content actually overflows. (Textual chose to drop `visible` entirely; we keep it as a default-friendly alias because users migrating from web/RN code expect the keyword to exist.)

**`Node` additions:**

```ts
class Node {
  scrollLeft: number;   // mutable; default 0
  scrollTop: number;    // mutable; default 0
  
  // derived from layout — populated during calculateLayout()
  readonly scrollWidth: number;   // unbounded content width when overflow !== 'visible'
  readonly scrollHeight: number;  // unbounded content height
}
```

`scrollLeft` / `scrollTop` are write-anywhere mutable fields. Bounds clamping is **not** the layout engine's job — `<ScrollView>` clamps before writing (so `getScrollOffset()` always returns a value in `[0, contentSize - viewportSize]`), and the renderer trusts the value as-is. If a consumer pokes a raw `Node.scrollTop` directly to an out-of-range value (rare; not the documented path), the renderer paints what the offset says, which produces a visually-empty viewport — not a crash. This contract keeps the layout pass pure and the renderer single-pass.

**Layout-engine spike** (1 hr, blocks the architecture): does Pilates' Yoga port let children of an `OVERFLOW_SCROLL` parent grow beyond the parent's main-axis size? In CSS, yes; in Yoga, possibly not (the enum is advisory). If children shrink to fit despite `overflow: scroll`, Pilates' core needs a fix — either a measurement-pass tweak or a "measure unbounded, then re-layout in viewport" two-pass approach. Verify with a single layout test before the architecture commits; both fixes are tractable but the second is meaningfully more expensive.

### Layer 2: `@pilates/render` — scissor-rect stack

The frame buffer gains a clipping primitive. Every cell write is filtered by the current scissor rect; writes outside the rect are dropped. Scissors stack so nested scrolling regions compose correctly (the failure mode that bit blessed for years).

```ts
// internal frame-buffer API
interface FrameBuffer {
  pushScissor(rect: ClipRect): void;
  popScissor(): void;
  setCell(x: number, y: number, cell: Cell): void;  // respects current scissor
}

interface ClipRect {
  left: number;
  top: number;
  width: number;
  height: number;
}
```

When the renderer encounters a node with `overflow !== 'visible'`:

1. Push scissor = node's content rect (the inner box minus borders/padding).
2. Translate child paint origin by `(-node.scrollLeft, -node.scrollTop)`.
3. Paint children recursively.
4. Pop scissor.
5. (If `overflow: scroll`, or `overflow: auto` and content overflowed) paint scrollbar inside the node's scrollbar gutter.

**Scrollbar painting** — text glyphs only, matching Textual / OpenTUI / blessed. Default thumb char `█`, default track char `' '` (single space, painted at the parent box's background color). Configurable via `scrollbarStyle` on `<ScrollView>`. For v1 the scrollbar always sits in the right gutter (vertical) or bottom gutter (horizontal) and steals 1 cell from the content area when present; no gutter-vs-overlay choice yet.

**When does the gutter exist?** Driven by the `scrollbar` prop on `<ScrollView>` (forwarded to `overflow` resolution at the render level):

- `scrollbar="always"` — gutter always present (one cell deducted from content even when content fits).
- `scrollbar="auto"` (default) — gutter present only when content overflows; layout reflows by 1 cell when content first overflows. (The reflow is a known minor visual jitter; matches Textual's behavior.)
- `scrollbar="never"` — no gutter ever; scrollbar suppressed even when overflowing.

Scrollbar geometry: thumb size = `viewport / content × scrollbarTrackLength`, thumb position = `scrollOffset / (content - viewport) × (trackLength - thumbLength)`. Clamp both to `[1, trackLength]` so a partially-visible scrollbar still has a thumb to drag (mouse-drag deferred but the math is the same).

**Diff integration:** `@pilates/diff` is unaffected — it diffs the painted frame, doesn't care that some cells were clipped. Scissor state lives entirely inside the paint pass and doesn't leak into the diff input.

### Layer 3: `@pilates/react` — `<ScrollView>` component

Single component, public surface. Lives in `@pilates/react` (not widgets) — the imperative `scrollTo` API is a fundamental capability, not domain-specific.

```tsx
type ScrollViewProps = {
  // sizing — height required for vertical, width required for horizontal
  height?: number | string;
  width?: number | string;
  
  // axis switch; default vertical-only
  horizontal?: boolean;
  
  // controlled / uncontrolled scroll position
  scrollOffset?: number;             // controlled
  defaultScrollOffset?: number;      // uncontrolled initial
  onScroll?: (offset: number, meta: ScrollMeta) => void;
  
  // sticky behavior
  stickToBottom?: boolean;           // when content grows, auto-scroll to end (paused if user scrolled away)
  stickToTop?: boolean;              // mutually exclusive with stickToBottom
  
  // input
  scrollEnabled?: boolean;           // default true; built-in arrow/PgUp/PgDn/Home/End when focused
  scrollOnFocus?: boolean;           // default true; auto-scroll-to-focused-descendant via useFocus integration
  
  // scrollbar
  scrollbar?: 'auto' | 'always' | 'never';   // default 'auto'
  scrollbarStyle?: { thumb?: string; track?: string; color?: Color };
  
  // content padding (RN-style — distinct from outer style)
  contentContainerStyle?: Style;
  
  // standard
  style?: Style;
  children?: ReactNode;
};

interface ScrollMeta {
  contentSize: number;
  viewportSize: number;
  atStart: boolean;
  atEnd: boolean;
}

interface ScrollViewHandle {
  scrollTo: (offset: number) => void;       // jumps; clamps to [0, contentSize - viewportSize]
  scrollBy: (delta: number) => void;
  scrollToEnd: () => void;
  scrollToStart: () => void;
  scrollIntoView: (target: RefObject<unknown>) => void;
  getScrollOffset: () => number;
  getContentSize: () => number;
  getViewportSize: () => number;
}
```

**Internals:**

`<ScrollView>` renders as a `<Box>` with `overflow: 'hidden'` (or `'scroll'` per the `scrollbar` prop) plus the explicit `height`/`width`. Its single child is a `<Box>` (the content container) with the user's children inside. The component owns scroll state (or reads it from the controlled prop), writes `scrollTop`/`scrollLeft` on the outer Box's underlying Node via a ref, and the renderer takes care of the clip + offset.

**Built-in keys (when focused via `useFocus`, `scrollEnabled` true):**

| Key | Action |
|---|---|
| Arrow Down/Up (or Right/Left if horizontal) | `scrollBy(±1)` |
| PgDn/PgUp | `scrollBy(±(viewport - 1))` |
| Home | `scrollToStart()` |
| End | `scrollToEnd()` |

Vi-style `j`/`k` is **not** in v1 — it interferes with text inputs in the same tree and we'd rather opt-in than opt-out. Apps that want vi keys wire them via `useInput` and call the imperative ref methods.

**Focus integration:**

`<ScrollView>` registers a context value exposing `notifyFocusedBounds(rect)`. Focusable widgets (`<TextInput>`, `<Select>`, etc.) observing this context call it on focus change with their bounding rect (in viewport coordinates). The handler computes the minimum scroll delta to bring the rect into view and calls `scrollTo`. Behind the `scrollOnFocus` prop, default `true`.

**Sticky-scroll semantics** (verbatim from OpenTUI — they got it right):

> When stickToBottom is true, content additions automatically scroll to bottom. When the user scrolls away from the bottom, sticky behavior pauses until they manually scroll back to the bottom edge.

Implementation: on each commit, compare new content size to old; if `stickToBottom` and the previous offset was at-end, `scrollToEnd()`. If the user has scrolled away from end, the at-end check fails and sticky pauses; once they return to end, it re-engages.

### Layer 4 (post-v1): `@pilates/widgets` `<LogView>`

Thin wrapper around `<ScrollView>` for log-buffer use cases. Lives in `@pilates/widgets`. Maps closely to blessed's `Log`.

```tsx
type LogViewProps = {
  height: number;
  scrollback?: number;        // default Infinity; cap on retained lines
  autoFollow?: boolean;       // default true; alias of stickToBottom
  // standard
  style?: Style;
};

interface LogViewHandle {
  append: (line: string) => void;
  clear: () => void;
  // ...inherits ScrollView's ref methods
}
```

Implementation: state ring buffer of `scrollback` size, render each line as `<Text>`, wrap in `<ScrollView stickToBottom={autoFollow}>`. Drops `scrollOnFocus` (log lines aren't focusable). 8 hours including tests.

## Public API surface (semver impact)

| Symbol | Package | Stability |
|---|---|---|
| `Style.overflow` / `overflowX` / `overflowY` | `@pilates/core` | **Public, stable** — `Overflow` literal-union, additive |
| `Node.scrollLeft` / `scrollTop` | `@pilates/core` | **Public, stable** — mutable fields |
| `Node.scrollWidth` / `scrollHeight` | `@pilates/core` | **Public, stable** — read-only |
| `<ScrollView>` | `@pilates/react` | **Public, stable** — entry-point export |
| `ScrollViewProps` / `ScrollViewHandle` / `ScrollMeta` | `@pilates/react` | **Public, stable** — type exports |
| `<LogView>` | `@pilates/widgets` | **Public, stable** — ships in a follow-on PR after `<ScrollView>` bakes ~1 week |
| `FrameBuffer.pushScissor` / `popScissor` | `@pilates/render` | **Internal** — not exported. Renderer owns the call sequence |

Version bumps (assuming the v1.0.0 promotion of core/render lands first per the existing 2026-05-13 bake floor — if it slips, render goes `1.0.0-rc.2 → 1.0.0` and core goes `1.0.0-rc.1 → 1.0.0` carrying the overflow additions in the same release):
- `@pilates/core` 1.0.0 → 1.1.0 (additive style — `Overflow` literal-union, mutable `scrollLeft`/`scrollTop`, derived `scrollWidth`/`scrollHeight`)
- `@pilates/render` 1.0.0 → 1.0.1 (no public surface change; internal scissor stack only — patch-level bump for clarity, not minor)
- `@pilates/react` 0.4.0 → 0.5.0 (new `<ScrollView>` component)
- `@pilates/widgets` 0.2.0 → 0.3.0 (new `<LogView>` widget; lands separately after `<ScrollView>` bakes ~1 week)

## Testing strategy

Three test layers, each gated by a different concern:

### `@pilates/core` — layout correctness

- `overflow: scroll` on a parent with width-100 children inside a width-50 container: children stay width-100, layout reports `scrollWidth = 100`.
- `overflow: hidden` matches `overflow: scroll` for layout purposes (clip is paint-time only).
- `overflow: visible` produces unchanged layout vs no overflow (default behavior).
- `scrollWidth` / `scrollHeight` are populated only when `overflow !== 'visible'` and reflect the unbounded content size.
- `overflowX` / `overflowY` resolution: longhand wins over shorthand; one-axis vs both-axis; missing values default to `visible`.

Compare against Yoga oracle for non-overflow cases. Pilates is on its own for overflow semantics — Yoga's `OVERFLOW_SCROLL` is advisory. Document this in the test file.

### `@pilates/render` — paint correctness

- Frame snapshot: clipped content at `scrollTop = 0` (top of content visible).
- Frame snapshot: clipped content at `scrollTop = 5` (scrolled 5 rows down; row 0-4 of content not visible).
- Frame snapshot: scrollbar visible for `overflow: scroll`, hidden for `overflow: auto` when content fits.
- Frame snapshot: scrollbar thumb position matches the scroll-percentage formula at three offsets (start, mid, end).
- Frame snapshot: nested scroll regions with independent scissor stacks paint correctly. (Two `<ScrollView>` components, one inside the other; scrolling the outer doesn't move the inner's clip.)
- Frame snapshot: `overflow: visible` is treated as `hidden` at paint time, with a dev-mode warning when content exceeds the box.

Add to the existing `@pilates/diff` test fixture pattern. New file: `packages/render/src/scissor.test.ts`.

### `@pilates/react` — behavior

- Controlled scroll-offset: parent sets `scrollOffset={5}`, internal scroll state matches.
- Uncontrolled with `defaultScrollOffset={3}`, then arrow Down increments to 4.
- `stickToBottom` with growing content: appends auto-scroll to end.
- `stickToBottom` with user scroll away: appends do NOT scroll back; user returning to end re-engages.
- `scrollIntoView` called via ref scrolls a focused descendant into view.
- Focus on a descendant outside the viewport auto-scrolls (with `scrollOnFocus={true}`).
- `scrollOnFocus={false}` disables the auto-scroll.
- Built-in keys when focused: arrow, PgUp/PgDn, Home/End all behave correctly.
- `scrollEnabled={false}` disables built-in keys.
- Imperative `scrollTo(N)` clamps to `[0, contentSize - viewportSize]`.

Use the existing `mountWithInput` test harness in `packages/react/src/test-utils.ts`.

## Phasing & budget

| Step | Package | Hours | Description |
|---|---|---|---|
| 0 | `@pilates/core` | 1 | Yoga `OVERFLOW_SCROLL` spike — verify children grow beyond parent main-axis. Block-or-go decision for steps 1-2. |
| 1 | `@pilates/core` + `@pilates/render` | 12 | Add `overflow` style, `scrollLeft`/`scrollTop` on Node, scrollWidth/scrollHeight derivation, scissor-rect stack in renderer, scrollbar painter. Internal-only; no React surface yet. |
| 2 | `@pilates/react` | 16 | `<ScrollView>` per the API above. Vertical only. Built-in keys. Focus integration. Stick-to-bottom logic. Tests. |
| 3 | `@pilates/widgets` | 8 | `<LogView>` wrapper + tests. (Lands as a separate PR after `<ScrollView>` bakes 1 week.) |
| 4 | docs | 4 | README "Scrolling" section, code-reference for `Overflow` style, migration story from Ink/`marginTop` hacks, "we have what Ink doesn't" framing per the greenfield ambition. |

**Total: 41 hours (1 hr over the original 40-hour budget).**

Phase 1 (steps 0-2) ships as one PR landing `<ScrollView>` and gets its own implementation plan written from this spec. Phase 2 (step 3, `<LogView>`) ships as a separate widget PR with its own short implementation plan. Step 4 docs go in both PRs.

**Implementation plan scope:** the first plan written from this spec covers Phase 1 only (~30 hours). The `<LogView>` plan is a small follow-on (~8 hours) once `<ScrollView>` has baked.

## Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| Yoga `OVERFLOW_SCROLL` shrinks children to fit (advisory not enforced) | Medium | Step-0 spike; if confirmed, escalate to a 2-pass measurement layer (~+8 hr to budget). |
| Scissor stack interaction with text-wrap pre-existing logic in renderer | Low | Existing wrap is cell-level; scissor is post-paint-write. Should compose, but cover with a test. |
| Focus-scroll loops (focused descendant scrolls into view, scroll triggers re-render that re-fires focus event, infinite loop) | Medium | Guard inside `scrollIntoView`: only act when target is actually outside viewport; debounce per-commit via `useEffect` flushing rather than render-time call. |
| `stickToBottom` with controlled `scrollOffset` race | Low | When controlled, `stickToBottom` is ignored — controlled mode is "parent owns state, period". Document this. |
| Performance regression: scissor check per cell is hot path | Low | Scissor is one bounds check; cheap. Profile with the existing `bench/` harness pre-merge; measure 10×100 grid before/after. |

## Open questions for spec review

1. **Scrollbar gutter:** v1 always-1-cell on right (vertical) / bottom (horizontal). Should we support `scrollbar="overlay"` later, where the scrollbar paints on top of content's last column? OpenTUI offers both; Textual prefers gutter. Defer to v1.1.
2. **Focus integration: opt-in or opt-out by default?** Current spec: `scrollOnFocus={true}` default. If we expect lots of layouts where the focused widget is fixed-position (not inside a `<ScrollView>`), the no-op cost is zero so default-on is fine. Confirm.
3. **`<LogView>` `append(line)` vs declarative `lines` prop?** Imperative ref method matches blessed's `Log.log()`; declarative matches React idiom but forces every consumer to manage their own ring buffer. Pick imperative for v1 (less boilerplate); revisit if friction.

## Sources

- [Ink scrolling issue #222](https://github.com/vadimdemedes/ink/issues/222) (open since 2019)
- [Ink Box overflow issue #432](https://github.com/vadimdemedes/ink/issues/432) (closed unresolved)
- [ink-scroll-view](https://github.com/ByteLandTechnology/ink-scroll-view), [ink-scrollbar](https://github.com/karaggeorge/ink-scrollbar), [ink-console](https://github.com/ForbesLindesay/ink-console)
- [OpenTUI ScrollBox](https://opentui.com/docs/components/scrollbox/) and [Rust port scissor stack](https://github.com/Dicklesworthstone/opentui_rust)
- [Textual overflow style](https://textual.textualize.io/styles/overflow/), [ScrollView API](https://textual.textualize.io/api/scroll_view/), [Widget scroll methods](https://textual.textualize.io/api/widget/)
- [ratatui Scrollbar](https://docs.rs/ratatui/latest/ratatui/widgets/struct.Scrollbar.html) and [RFC #174 (unresolved)](https://github.com/ratatui/ratatui/issues/174)
- [blessed README — ScrollableBox / ScrollableText / Log](https://github.com/chjj/blessed/blob/master/README.md)
- [Yoga YGEnums.h — Overflow enum](https://github.com/facebook/yoga/blob/main/yoga/YGEnums.h), [Yoga issue #1804: scrollable areas advisory](https://github.com/facebook/yoga/issues/1804)
- [React Native ScrollView](https://reactnative.dev/docs/scrollview)
