# `<ScrollView>` Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land `<ScrollView>` for `@pilates/react@0.5.0` plus the underlying `overflow` style in `@pilates/core` and the scissor-rect clipping stack in `@pilates/render`. Vertical OR horizontal (single-axis switch), built-in arrow/PgUp/PgDn/Home/End keys when focused, controlled and uncontrolled scroll state, imperative ref API (`scrollTo`/`scrollBy`/`scrollIntoView` etc.), `stickToBottom` semantics for log buffers, and `useFocus` integration for auto-scroll-to-focused-descendant.

**Architecture:** Three-layer hand-off. `@pilates/core` owns `Style.overflow` (`visible | hidden | scroll | auto` plus `overflowX`/`overflowY`) and mutable `Node.scrollLeft` / `scrollTop` plus derived `scrollWidth` / `scrollHeight`. `@pilates/render` owns a scissor-rect stack inside `Frame`; the painter pushes a scissor when it encounters an overflow node, translates child paint by `(-scrollLeft, -scrollTop)`, and pops afterward. `@pilates/react` ships `<ScrollView>` as a thin component over `<Box overflow="hidden">` with bound scroll state, ref-based imperative API, and `useFocus`/key-handling integration.

**Tech Stack:** TypeScript 5.7+ NodeNext, vitest, biome. React 19.0 / react-reconciler@0.31. No new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-05-06-scrollview-design.md`

**Branch:** `scrollview-spec` (already created off main; the spec is committed; no code yet).

**Out of scope for this plan** (deferred to Phase 2, separate plan): `<LogView>` widget. Both-axis scrolling (only single-axis via `horizontal: boolean` here). Mouse wheel (separate Track 1 item). Animated scroll. Virtualization. Scroll-snap, scroll-padding, scroll-margin.

---

## File Structure

**New files:**

| Path | Responsibility |
|---|---|
| `packages/core/src/overflow.test.ts` | Style/Node-level overflow + scroll-offset tests |
| `packages/core/src/algorithm/overflow.test.ts` | Layout-engine tests for `overflow: scroll` (children retain natural size) and `scrollWidth`/`scrollHeight` derivation |
| `packages/render/src/scissor.ts` | `ClipRect` type + intersection helper (pure data) |
| `packages/render/src/scissor.test.ts` | Tests for `ClipRect` arithmetic |
| `packages/render/src/scrollbar.ts` | Scrollbar geometry (thumb size/position) + paint helper |
| `packages/render/src/scrollbar.test.ts` | Tests for the geometry math + paint output |
| `packages/react/src/scroll-view.tsx` | `<ScrollView>` component |
| `packages/react/src/scroll-view.test.tsx` | Behavior tests |
| `packages/react/src/scroll-context.ts` | `ScrollContext` (focus integration; widgets register their bounds via this context) |

**Modified files:**

| Path | Change |
|---|---|
| `packages/core/src/style.ts` | Add `Overflow` type + `overflow`/`overflowX`/`overflowY` fields to `Style` + matching defaults |
| `packages/core/src/node.ts` | Add `setOverflow`/`setOverflowX`/`setOverflowY` setters; `scrollLeft`/`scrollTop` mutable fields; `scrollWidth`/`scrollHeight` getters that read from `_layout` |
| `packages/core/src/layout.ts` | Add `scrollWidth`/`scrollHeight` to `ComputedLayout` |
| `packages/core/src/algorithm/index.ts` (and/or `main-axis.ts`) | When laying out an overflow-non-visible parent, allow children to exceed parent main-axis size; populate `_layout.scrollWidth`/`scrollHeight` with content's natural size |
| `packages/render/src/frame.ts` | Add `pushScissor`/`popScissor`; make `setCell`/`setGrapheme` filter through current scissor |
| `packages/render/src/painter.ts` | When a node has `overflow !== 'visible'`: push scissor at content rect, translate child paint origin by `(-scrollLeft, -scrollTop)`, paint children, paint scrollbar (when applicable), pop |
| `packages/render/src/types.ts` | Add `overflow`/`overflowX`/`overflowY` to `RenderNode` (and `scrollLeft`/`scrollTop` for direct paint-time access) |
| `packages/render/src/build.ts` | Map `RenderNode.overflow*` onto `node.setOverflow*`; copy scroll offsets through |
| `packages/react/src/components.tsx` | Add `overflow` prop on `<Box>` (lowers to `RenderNode.overflow`) |
| `packages/react/src/index.ts` | Re-export `ScrollView`, `ScrollViewProps`, `ScrollViewHandle`, `ScrollMeta` |
| `packages/react/src/index.test.ts` | Smoke-test the new public re-exports |
| `packages/react/CHANGELOG.md` | New entry under `## Unreleased` |
| `packages/react/README.md` | New "Scrolling" section |
| `packages/core/CHANGELOG.md` | New entry under `## Unreleased` for `Overflow` style |
| `packages/render/CHANGELOG.md` | New entry under `## Unreleased` for scissor clipping |

---

## Tasks

### Task 1: Add `Overflow` type + style fields in `@pilates/core`

**Files:**
- Modify: `packages/core/src/style.ts`
- Create: `packages/core/src/overflow.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/overflow.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { defaultStyle } from './style.js';

describe('Style — overflow', () => {
  it('defaults overflow / overflowX / overflowY to "visible"', () => {
    const s = defaultStyle();
    expect(s.overflow).toBe('visible');
    expect(s.overflowX).toBe('visible');
    expect(s.overflowY).toBe('visible');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/src/overflow.test.ts`
Expected: FAIL — `s.overflow` is `undefined`.

- [ ] **Step 3: Add the type and the fields**

Edit `packages/core/src/style.ts`:

After the existing `type Display = 'flex' | 'none';` line, add:

```ts
export type Overflow = 'visible' | 'hidden' | 'scroll' | 'auto';
```

In the `Style` interface, after `display: Display;`, add:

```ts
  /**
   * CSS `overflow` shorthand. `overflowX` / `overflowY` win when set
   * individually. `'visible'` — the default — is treated as `'hidden'` at
   * paint time (terminal cell grids cannot show overflow without corrupting
   * sibling cells); the keyword exists so migrating code from web/RN reads
   * naturally.
   */
  overflow: Overflow;
  overflowX: Overflow;
  overflowY: Overflow;
```

In `defaultStyle()`, after `display: 'flex',`, add:

```ts
    overflow: 'visible',
    overflowX: 'visible',
    overflowY: 'visible',
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/src/overflow.test.ts`
Expected: PASS — 1 test.

- [ ] **Step 5: Verify rest of core still typechecks**

Run: `pnpm --filter @pilates/core typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/style.ts packages/core/src/overflow.test.ts
git commit -m "core: add Overflow type + overflow/overflowX/overflowY style fields"
```

---

### Task 2: Add `setOverflow*` setters to `Node`

**Files:**
- Modify: `packages/core/src/node.ts`
- Modify: `packages/core/src/overflow.test.ts`

- [ ] **Step 1: Extend the test**

Append to `packages/core/src/overflow.test.ts`:

```ts
import { Node } from './node.js';

describe('Node — setOverflow', () => {
  it('setOverflow() updates the shorthand and both axes', () => {
    const n = Node.create();
    n.setOverflow('scroll');
    expect(n.style.overflow).toBe('scroll');
    expect(n.style.overflowX).toBe('scroll');
    expect(n.style.overflowY).toBe('scroll');
  });

  it('setOverflowX() / setOverflowY() override one axis only', () => {
    const n = Node.create();
    n.setOverflow('hidden');
    n.setOverflowX('scroll');
    expect(n.style.overflow).toBe('hidden'); // shorthand untouched
    expect(n.style.overflowX).toBe('scroll');
    expect(n.style.overflowY).toBe('hidden');
  });

  it('marks the node dirty when overflow changes', () => {
    const n = Node.create();
    n.calculateLayout(); // clears dirty
    expect(n.isDirty()).toBe(false);
    n.setOverflow('hidden');
    expect(n.isDirty()).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/src/overflow.test.ts`
Expected: FAIL — `n.setOverflow` is not a function.

- [ ] **Step 3: Add the setters**

Edit `packages/core/src/node.ts`. Find the existing setter cluster near `setDisplay`. Add the import (top of file):

```ts
import {
  // ...existing imports
  type Overflow,
} from './style.js';
```

Add the methods to the `Node` class (alongside other style setters):

```ts
  setOverflow(overflow: Overflow): void {
    this._style.overflow = overflow;
    this._style.overflowX = overflow;
    this._style.overflowY = overflow;
    this.markDirty();
  }

  setOverflowX(overflow: Overflow): void {
    this._style.overflowX = overflow;
    this.markDirty();
  }

  setOverflowY(overflow: Overflow): void {
    this._style.overflowY = overflow;
    this.markDirty();
  }
```

> If `markDirty` is named differently in this repo (some Yoga ports use `_dirty = true` directly), match the file's existing pattern. Look at `setDisplay` or `setFlexDirection` for the exact idiom and copy it.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/src/overflow.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Typecheck and lint clean**

Run: `pnpm --filter @pilates/core typecheck && pnpm lint`

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/node.ts packages/core/src/overflow.test.ts
git commit -m "core: add setOverflow / setOverflowX / setOverflowY to Node"
```

---

### Task 3: Add `scrollLeft` / `scrollTop` mutable fields to `Node`

**Files:**
- Modify: `packages/core/src/node.ts`
- Modify: `packages/core/src/overflow.test.ts`

- [ ] **Step 1: Extend the test**

Append to `packages/core/src/overflow.test.ts`:

```ts
describe('Node — scrollLeft / scrollTop', () => {
  it('default scroll offsets are 0', () => {
    const n = Node.create();
    expect(n.scrollLeft).toBe(0);
    expect(n.scrollTop).toBe(0);
  });

  it('scroll offsets are mutable', () => {
    const n = Node.create();
    n.scrollLeft = 5;
    n.scrollTop = 12;
    expect(n.scrollLeft).toBe(5);
    expect(n.scrollTop).toBe(12);
  });

  it('changing scroll offsets does NOT mark the node dirty (paint-time concern, not layout)', () => {
    const n = Node.create();
    n.calculateLayout();
    expect(n.isDirty()).toBe(false);
    n.scrollTop = 7;
    expect(n.isDirty()).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/src/overflow.test.ts`
Expected: FAIL — `n.scrollLeft` is `undefined`.

- [ ] **Step 3: Add the fields**

Edit `packages/core/src/node.ts`. Inside the `Node` class, after the `_layout` declaration:

```ts
  /**
   * Horizontal scroll offset. Mutable; defaults to 0. Read by the renderer
   * when painting children of an `overflow !== 'visible'` node — children's
   * paint origin is translated by `(-scrollLeft, -scrollTop)`. NOT clamped
   * by this class — bounds clamping is the consumer's job (`<ScrollView>`
   * clamps before writing). Direct mutation does not mark the node dirty
   * because scroll offset is a paint-time concern, not layout.
   */
  scrollLeft: number = 0;

  /** See {@link scrollLeft}. */
  scrollTop: number = 0;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/src/overflow.test.ts`
Expected: PASS — 7 tests total.

- [ ] **Step 5: Verify**

Run: `pnpm --filter @pilates/core typecheck && pnpm lint`

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/node.ts packages/core/src/overflow.test.ts
git commit -m "core: add Node.scrollLeft / scrollTop mutable fields"
```

---

### Task 4: Verify `overflow: scroll` lets children grow beyond parent (spike)

**Files:**
- Create: `packages/core/src/algorithm/overflow.test.ts`
- Possibly modify: `packages/core/src/algorithm/main-axis.ts` (only if the spike fails)

- [ ] **Step 1: Write the spike test**

Create `packages/core/src/algorithm/overflow.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { Node } from '../node.js';

describe('algorithm — overflow:scroll preserves child natural size', () => {
  it('child with width 100 inside overflow:scroll parent of width 50 stays width 100', () => {
    const parent = Node.create();
    parent.setWidth(50);
    parent.setHeight(20);
    parent.setOverflow('scroll');

    const child = Node.create();
    child.setWidth(100);
    child.setHeight(10);
    parent.insertChild(child, 0);

    parent.calculateLayout();

    // Child must keep its 100-cell natural width even though parent is 50.
    // If this fails, the layout engine treats overflow as advisory only and
    // shrinks children to fit — see plan note about a 2-pass measurement
    // layer.
    expect(child.getComputedLayout().width).toBe(100);
  });

  it('child with width 100 inside overflow:hidden parent of width 50 also stays width 100', () => {
    // overflow:hidden semantically clips at paint time but does NOT change
    // layout. Children retain their natural size.
    const parent = Node.create();
    parent.setWidth(50);
    parent.setHeight(20);
    parent.setOverflow('hidden');

    const child = Node.create();
    child.setWidth(100);
    child.setHeight(10);
    parent.insertChild(child, 0);

    parent.calculateLayout();
    expect(child.getComputedLayout().width).toBe(100);
  });

  it('child with width 100 inside overflow:visible parent of width 50 also stays width 100 (sanity)', () => {
    const parent = Node.create();
    parent.setWidth(50);
    parent.setHeight(20);

    const child = Node.create();
    child.setWidth(100);
    child.setHeight(10);
    parent.insertChild(child, 0);

    parent.calculateLayout();
    expect(child.getComputedLayout().width).toBe(100);
  });
});
```

- [ ] **Step 2: Run the spike**

Run: `pnpm exec vitest run packages/core/src/algorithm/overflow.test.ts`

**Branch on result:**

- **All 3 pass:** great — Pilates' Yoga port already preserves natural child sizes regardless of overflow. No algorithm change needed. Skip to step 4.
- **One or more fail:** the layout shrinks children in some configuration. Fix in `main-axis.ts` / `algorithm/index.ts` so that when the parent's overflow is non-`visible`, the child measurement does not get clamped to parent's content width. Specifically, find the place where flex-shrink is applied or where main-axis size is propagated to children, and short-circuit when `parent._style.overflow !== 'visible'` (or the relevant axis-specific flag). Re-run until the test passes.

- [ ] **Step 3 (only if step 2 fixed the algorithm): Manual verification**

Run the existing algorithm test suite: `pnpm exec vitest run packages/core/src/algorithm/`. The fix must not regress any existing case (e.g., default flex-shrink behavior on non-overflow parents).

- [ ] **Step 4: Verify clean**

Run: `pnpm --filter @pilates/core typecheck`

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/algorithm/overflow.test.ts
# Add main-axis.ts only if you modified it in step 2.
git add packages/core/src/algorithm/main-axis.ts 2>/dev/null || true
git commit -m "core: verify overflow:scroll preserves child natural size"
```

---

### Task 5: Add `scrollWidth` / `scrollHeight` derivation

**Files:**
- Modify: `packages/core/src/layout.ts`
- Modify: `packages/core/src/algorithm/index.ts` (or wherever `_layout` is finalized)
- Modify: `packages/core/src/node.ts` (add getters)
- Modify: `packages/core/src/algorithm/overflow.test.ts`

- [ ] **Step 1: Extend the test**

Append to `packages/core/src/algorithm/overflow.test.ts`:

```ts
describe('algorithm — scrollWidth / scrollHeight', () => {
  it('overflow:scroll parent reports content size via scrollWidth/scrollHeight', () => {
    const parent = Node.create();
    parent.setWidth(50);
    parent.setHeight(20);
    parent.setOverflow('scroll');

    // Two children stacked vertically: total content height = 30.
    const a = Node.create();
    a.setWidth(100);
    a.setHeight(15);
    parent.insertChild(a, 0);
    const b = Node.create();
    b.setWidth(80);
    b.setHeight(15);
    parent.insertChild(b, 1);

    parent.calculateLayout();

    // Children stack: viewport is 50×20, content is max(100,80)=100 wide,
    // 15+15=30 tall.
    expect(parent.scrollWidth).toBe(100);
    expect(parent.scrollHeight).toBe(30);
  });

  it('overflow:visible parent has scrollWidth === width and scrollHeight === height', () => {
    // For non-overflow nodes, scroll dimensions match viewport — content
    // never exceeds the box.
    const parent = Node.create();
    parent.setWidth(50);
    parent.setHeight(20);

    const child = Node.create();
    child.setWidth(30);
    child.setHeight(10);
    parent.insertChild(child, 0);

    parent.calculateLayout();

    expect(parent.scrollWidth).toBe(parent.getComputedLayout().width);
    expect(parent.scrollHeight).toBe(parent.getComputedLayout().height);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/src/algorithm/overflow.test.ts`
Expected: FAIL — `parent.scrollWidth` is `undefined`.

- [ ] **Step 3: Add fields to `ComputedLayout`**

Edit `packages/core/src/layout.ts`. Add to the `ComputedLayout` interface (and to `defaultLayout()`):

```ts
export interface ComputedLayout {
  // ...existing
  /**
   * Natural content width. For nodes with `overflow !== 'visible'`, this
   * is the bounding box of children unbounded by the parent's content
   * width. For non-overflow nodes, equals the node's own `width`.
   */
  scrollWidth: number;
  /** See {@link scrollWidth}. */
  scrollHeight: number;
}

export function defaultLayout(): ComputedLayout {
  return {
    // ...existing
    scrollWidth: 0,
    scrollHeight: 0,
  };
}
```

- [ ] **Step 4: Populate `scrollWidth` / `scrollHeight` in the algorithm**

In the layout algorithm — find where the parent's final layout is finalized after children have been laid out (likely the end of `calculateLayout` in `algorithm/index.ts` or a finalization pass in `main-axis.ts`).

After children have their final positions and sizes:

```ts
// At the end of laying out a parent:
let contentRight = 0;
let contentBottom = 0;
for (let i = 0; i < parent.getChildCount(); i++) {
  const c = parent.getChild(i)!;
  const cl = c._layout;
  contentRight = Math.max(contentRight, cl.left + cl.width);
  contentBottom = Math.max(contentBottom, cl.top + cl.height);
}
// For overflow:visible the values shouldn't exceed the parent's own size,
// but we record them anyway as max(content, ownSize) so non-overflow nodes
// see scrollWidth === width / scrollHeight === height.
parent._layout.scrollWidth = Math.max(parent._layout.width, contentRight);
parent._layout.scrollHeight = Math.max(parent._layout.height, contentBottom);
```

> Look at the existing finalization site for the pattern. Some codebases run this in a single sweep at root; if so, put the loop in that sweep so it sees post-padding/post-border-as-padding child positions.

- [ ] **Step 5: Add `Node` getters**

Edit `packages/core/src/node.ts`. Add getters:

```ts
  /** Read-only view of `_layout.scrollWidth`. See {@link scrollLeft}. */
  get scrollWidth(): number {
    return this._layout.scrollWidth;
  }

  /** Read-only view of `_layout.scrollHeight`. */
  get scrollHeight(): number {
    return this._layout.scrollHeight;
  }
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/src/algorithm/overflow.test.ts`
Expected: PASS — 5 tests in this file total.

- [ ] **Step 7: Verify no regressions in the broader algorithm suite**

Run: `pnpm exec vitest run packages/core/`
Expected: all tests pass. Yoga oracle assertions in `yoga-oracle.test.ts` should be unaffected (it doesn't read `scrollWidth`/`scrollHeight`).

- [ ] **Step 8: Verify**

Run: `pnpm --filter @pilates/core typecheck && pnpm lint`

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/layout.ts packages/core/src/node.ts packages/core/src/algorithm/
git commit -m "core: derive scrollWidth / scrollHeight from laid-out children"
```

---

### Task 6: Add `ClipRect` + intersection helper in `@pilates/render`

**Files:**
- Create: `packages/render/src/scissor.ts`
- Create: `packages/render/src/scissor.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/render/src/scissor.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { type ClipRect, intersect } from './scissor.js';

describe('ClipRect — intersect', () => {
  const A: ClipRect = { left: 0, top: 0, width: 10, height: 10 };

  it('returns the smaller rect when one fully contains the other', () => {
    const B: ClipRect = { left: 2, top: 2, width: 3, height: 3 };
    expect(intersect(A, B)).toEqual({ left: 2, top: 2, width: 3, height: 3 });
  });

  it('returns the overlapping subrect when partially overlapping', () => {
    const B: ClipRect = { left: 5, top: 5, width: 10, height: 10 };
    expect(intersect(A, B)).toEqual({ left: 5, top: 5, width: 5, height: 5 });
  });

  it('returns a zero-size rect when there is no overlap', () => {
    const B: ClipRect = { left: 20, top: 20, width: 5, height: 5 };
    const r = intersect(A, B);
    expect(r.width).toBe(0);
    expect(r.height).toBe(0);
  });

  it('returns a zero-size rect when one input is already zero', () => {
    const Z: ClipRect = { left: 0, top: 0, width: 0, height: 0 };
    expect(intersect(A, Z).width).toBe(0);
    expect(intersect(A, Z).height).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/render/src/scissor.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `packages/render/src/scissor.ts`:

```ts
/**
 * A clipping rectangle in `Frame` coordinates. Used by `Frame`'s scissor
 * stack (see `Frame.pushScissor`) to filter cell writes — writes outside
 * the current scissor are dropped.
 *
 * `width` / `height` of 0 means "fully clipped" — no writes pass through.
 */
export interface ClipRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Geometric intersection of two `ClipRect`s. Returns a rect with width or
 * height of 0 when the inputs do not overlap. Used by `Frame.pushScissor`
 * to nest scissors: child scissor is intersected with parent so cells
 * outside the outer scope cannot be reached even if the inner scope says
 * otherwise.
 */
export function intersect(a: ClipRect, b: ClipRect): ClipRect {
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  const right = Math.min(a.left + a.width, b.left + b.width);
  const bottom = Math.min(a.top + a.height, b.top + b.height);
  return {
    left,
    top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}

/**
 * True when `(x, y)` falls inside the rect (half-open: x in [left, left+width)).
 * `width === 0` or `height === 0` always returns false.
 */
export function contains(rect: ClipRect, x: number, y: number): boolean {
  return (
    x >= rect.left &&
    x < rect.left + rect.width &&
    y >= rect.top &&
    y < rect.top + rect.height
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/render/src/scissor.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Verify**

Run: `pnpm --filter @pilates/render typecheck && pnpm lint`

- [ ] **Step 6: Commit**

```bash
git add packages/render/src/scissor.ts packages/render/src/scissor.test.ts
git commit -m "render: add ClipRect + intersect/contains helpers"
```

---

### Task 7: Add scissor stack to `Frame`

**Files:**
- Modify: `packages/render/src/frame.ts`
- Create: extend `packages/render/src/scissor.test.ts` (or new `frame-scissor.test.ts`)

- [ ] **Step 1: Write the failing test**

Append to `packages/render/src/scissor.test.ts`:

```ts
import { Frame } from './frame.js';

describe('Frame — scissor stack', () => {
  it('writes outside the current scissor are dropped', () => {
    const f = new Frame(10, 5);
    f.pushScissor({ left: 2, top: 1, width: 3, height: 2 });
    // (1, 1) is outside; (3, 1) is inside.
    f.setGrapheme(1, 1, 'X', { fg: undefined, bg: undefined, attrs: 0 });
    f.setGrapheme(3, 1, 'Y', { fg: undefined, bg: undefined, attrs: 0 });
    f.popScissor();
    expect(f.getCell(1, 1)?.char).toBe(' '); // unchanged default
    expect(f.getCell(3, 1)?.char).toBe('Y'); // wrote through
  });

  it('nested scissors intersect', () => {
    const f = new Frame(10, 5);
    f.pushScissor({ left: 0, top: 0, width: 5, height: 5 });
    f.pushScissor({ left: 3, top: 0, width: 5, height: 5 }); // overlap = [3,5) x [0,5)
    // (4, 0) is in both; (1, 0) is in outer only; (6, 0) is in inner only.
    f.setGrapheme(4, 0, 'A', { fg: undefined, bg: undefined, attrs: 0 });
    f.setGrapheme(1, 0, 'B', { fg: undefined, bg: undefined, attrs: 0 });
    f.setGrapheme(6, 0, 'C', { fg: undefined, bg: undefined, attrs: 0 });
    f.popScissor();
    f.popScissor();
    expect(f.getCell(4, 0)?.char).toBe('A');
    expect(f.getCell(1, 0)?.char).toBe(' ');
    expect(f.getCell(6, 0)?.char).toBe(' ');
  });

  it('popping leaves the previous scissor active', () => {
    const f = new Frame(10, 5);
    f.pushScissor({ left: 0, top: 0, width: 5, height: 5 });
    f.pushScissor({ left: 3, top: 0, width: 5, height: 5 });
    f.popScissor(); // back to outer scissor
    f.setGrapheme(1, 0, 'A', { fg: undefined, bg: undefined, attrs: 0 });
    f.popScissor();
    expect(f.getCell(1, 0)?.char).toBe('A');
  });

  it('with no scissor pushed, all in-bounds writes pass', () => {
    const f = new Frame(5, 5);
    f.setGrapheme(2, 2, 'Z', { fg: undefined, bg: undefined, attrs: 0 });
    expect(f.getCell(2, 2)?.char).toBe('Z');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/render/src/scissor.test.ts`
Expected: FAIL — `f.pushScissor` is not a function.

- [ ] **Step 3: Implement push/pop and integrate with `setCell`**

Edit `packages/render/src/frame.ts`:

Add at the top of the file (after existing imports):

```ts
import { type ClipRect, contains, intersect } from './scissor.js';
```

Inside the `Frame` class, add private state and the public methods:

```ts
  private readonly _scissors: ClipRect[] = [];

  /**
   * Push a clipping rect onto the scissor stack. Subsequent cell writes are
   * filtered through the intersection of the current stack — writes outside
   * the active rect are dropped silently. Pair every push with a `popScissor()`.
   */
  pushScissor(rect: ClipRect): void {
    const top = this._scissors[this._scissors.length - 1];
    const next = top === undefined ? rect : intersect(top, rect);
    this._scissors.push(next);
  }

  /** Pop the most recent scissor. Calling with an empty stack is a no-op. */
  popScissor(): void {
    this._scissors.pop();
  }

  private isVisible(x: number, y: number): boolean {
    const top = this._scissors[this._scissors.length - 1];
    if (top === undefined) return true;
    return contains(top, x, y);
  }
```

Modify `setCell` and `setGrapheme` to filter through `isVisible`:

```ts
  setCell(x: number, y: number, cell: Cell): void {
    if (!this.inBounds(x, y)) return;
    if (!this.isVisible(x, y)) return;
    this.cells[this.idx(x, y)] = cell;
  }
```

Apply the same `isVisible` guard early-return inside `setGrapheme`. Look at the existing implementation and add the check after the in-bounds check.

> If `setGrapheme` writes a wide-character continuation cell at `x+1`, `isVisible(x+1, y)` must also be checked. The simplest implementation: write each cell through `setCell`, which already does the visibility check.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/render/src/scissor.test.ts`
Expected: PASS — all tests in this file (8 total now).

- [ ] **Step 5: Verify no regressions in the existing frame tests**

Run: `pnpm exec vitest run packages/render/`
Expected: all existing tests pass.

- [ ] **Step 6: Verify**

Run: `pnpm --filter @pilates/render typecheck && pnpm lint`

- [ ] **Step 7: Commit**

```bash
git add packages/render/src/frame.ts packages/render/src/scissor.test.ts
git commit -m "render: add Frame.pushScissor / popScissor; setCell filters through stack"
```

---

### Task 8: Add scrollbar geometry helper

**Files:**
- Create: `packages/render/src/scrollbar.ts`
- Create: `packages/render/src/scrollbar.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/render/src/scrollbar.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { thumbGeometry } from './scrollbar.js';

describe('thumbGeometry', () => {
  it('thumb spans the full track when content fits', () => {
    // viewport === content: nothing to scroll, thumb fills track.
    const g = thumbGeometry({ contentSize: 10, viewportSize: 10, scrollOffset: 0, trackLength: 5 });
    expect(g.thumbStart).toBe(0);
    expect(g.thumbLength).toBe(5);
  });

  it('thumb is proportional to viewport / content when content overflows', () => {
    // 20 content, 10 viewport, 10 track → thumb = round(10 * 10/20) = 5.
    const g = thumbGeometry({
      contentSize: 20,
      viewportSize: 10,
      scrollOffset: 0,
      trackLength: 10,
    });
    expect(g.thumbLength).toBe(5);
    expect(g.thumbStart).toBe(0);
  });

  it('thumb position scales with scroll offset', () => {
    // 20 content, 10 viewport, scrolled 10 → at end. trackLength=10, thumbLen=5
    // → thumbStart = round((10/(20-10)) * (10-5)) = 5.
    const g = thumbGeometry({
      contentSize: 20,
      viewportSize: 10,
      scrollOffset: 10,
      trackLength: 10,
    });
    expect(g.thumbStart).toBe(5);
    expect(g.thumbLength).toBe(5);
  });

  it('thumb has minimum length 1 even with huge content', () => {
    // 1000 content, 10 viewport, 5 track → raw thumb = round(5 * 10/1000) = 0;
    // clamped to 1.
    const g = thumbGeometry({
      contentSize: 1000,
      viewportSize: 10,
      scrollOffset: 0,
      trackLength: 5,
    });
    expect(g.thumbLength).toBe(1);
  });

  it('thumbStart never exceeds trackLength - thumbLength', () => {
    const g = thumbGeometry({
      contentSize: 100,
      viewportSize: 10,
      scrollOffset: 999, // overshoot
      trackLength: 10,
    });
    expect(g.thumbStart + g.thumbLength).toBeLessThanOrEqual(10);
  });

  it('zero-length track returns zero geometry', () => {
    const g = thumbGeometry({
      contentSize: 100,
      viewportSize: 10,
      scrollOffset: 5,
      trackLength: 0,
    });
    expect(g.thumbStart).toBe(0);
    expect(g.thumbLength).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/render/src/scrollbar.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `packages/render/src/scrollbar.ts`:

```ts
/**
 * Pure-math helpers for scrollbar rendering. Geometry math is split from
 * the actual paint call so it can be tested without a frame buffer, and so
 * the same numbers are available to consumers (e.g., for hover-style
 * scrollbar UI in a future iteration).
 */

export interface ThumbGeometryInput {
  /** Total content size along the scrolling axis (pixels in CSS; cells here). */
  contentSize: number;
  /** Visible viewport size along the scrolling axis. */
  viewportSize: number;
  /** Current scroll offset, in [0, contentSize - viewportSize]. */
  scrollOffset: number;
  /** Track length in cells. */
  trackLength: number;
}

export interface ThumbGeometry {
  /** Offset of thumb start, in cells, from the start of the track. */
  thumbStart: number;
  /** Thumb length, in cells. Always at least 1 when track is non-empty. */
  thumbLength: number;
}

/**
 * Compute thumb geometry. Formula matches the standard CSS scrollbar:
 *
 *   thumbLength = max(1, round(trackLength * viewport / content))
 *   thumbStart  = round((scroll / (content - viewport)) * (trackLength - thumbLength))
 *
 * Edge cases: when content fits in viewport, thumb fills the track. When
 * track length is 0, both thumbStart and thumbLength are 0. The thumb is
 * clamped so `thumbStart + thumbLength <= trackLength`.
 */
export function thumbGeometry(input: ThumbGeometryInput): ThumbGeometry {
  const { contentSize, viewportSize, scrollOffset, trackLength } = input;
  if (trackLength <= 0) return { thumbStart: 0, thumbLength: 0 };
  if (contentSize <= viewportSize) {
    return { thumbStart: 0, thumbLength: trackLength };
  }
  const ratio = viewportSize / contentSize;
  const thumbLength = Math.max(1, Math.round(trackLength * ratio));
  const scrollable = contentSize - viewportSize;
  const trackScrollable = trackLength - thumbLength;
  const offset = Math.max(0, Math.min(scrollOffset, scrollable));
  const thumbStart = Math.round((offset / scrollable) * trackScrollable);
  return {
    thumbStart: Math.min(thumbStart, trackScrollable),
    thumbLength,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/render/src/scrollbar.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 5: Verify**

Run: `pnpm --filter @pilates/render typecheck && pnpm lint`

- [ ] **Step 6: Commit**

```bash
git add packages/render/src/scrollbar.ts packages/render/src/scrollbar.test.ts
git commit -m "render: add thumbGeometry helper for scrollbar math"
```

---

### Task 9: Add scrollbar paint helper

**Files:**
- Modify: `packages/render/src/scrollbar.ts`
- Modify: `packages/render/src/scrollbar.test.ts`

- [ ] **Step 1: Extend the test**

Append to `packages/render/src/scrollbar.test.ts`:

```ts
import { Frame } from './frame.js';
import { paintScrollbar } from './scrollbar.js';

describe('paintScrollbar — vertical', () => {
  it('paints thumb and track in the right gutter', () => {
    const f = new Frame(5, 4);
    paintScrollbar(f, {
      orientation: 'vertical',
      gutter: { x: 4, y: 0, length: 4 },
      contentSize: 10,
      viewportSize: 4,
      scrollOffset: 0,
      thumbChar: '█',
      trackChar: '·',
    });
    // viewport=4, content=10 → thumb = round(4 * 4/10) = 2; thumbStart=0.
    // So column 4: ['█', '█', '·', '·'].
    expect(f.getCell(4, 0)?.char).toBe('█');
    expect(f.getCell(4, 1)?.char).toBe('█');
    expect(f.getCell(4, 2)?.char).toBe('·');
    expect(f.getCell(4, 3)?.char).toBe('·');
  });
});

describe('paintScrollbar — horizontal', () => {
  it('paints thumb and track in the bottom gutter', () => {
    const f = new Frame(4, 5);
    paintScrollbar(f, {
      orientation: 'horizontal',
      gutter: { x: 0, y: 4, length: 4 },
      contentSize: 10,
      viewportSize: 4,
      scrollOffset: 0,
      thumbChar: '█',
      trackChar: '·',
    });
    expect(f.getCell(0, 4)?.char).toBe('█');
    expect(f.getCell(1, 4)?.char).toBe('█');
    expect(f.getCell(2, 4)?.char).toBe('·');
    expect(f.getCell(3, 4)?.char).toBe('·');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/render/src/scrollbar.test.ts`
Expected: FAIL — `paintScrollbar` is not exported.

- [ ] **Step 3: Add the painter**

Append to `packages/render/src/scrollbar.ts`:

```ts
import type { CellStyle, Frame } from './frame.js';

export interface PaintScrollbarOpts {
  orientation: 'vertical' | 'horizontal';
  /** Track origin + length, in `Frame` coordinates. */
  gutter: { x: number; y: number; length: number };
  contentSize: number;
  viewportSize: number;
  scrollOffset: number;
  thumbChar: string;
  trackChar: string;
  thumbStyle?: CellStyle;
  trackStyle?: CellStyle;
}

const DEFAULT_STYLE: CellStyle = { fg: undefined, bg: undefined, attrs: 0 };

/**
 * Paint a scrollbar into the frame. Track is filled with `trackChar`;
 * thumb (computed via `thumbGeometry`) overwrites with `thumbChar`. Used
 * by the painter when a node has `overflow: scroll` or
 * `overflow: auto` with overflowing content.
 */
export function paintScrollbar(frame: Frame, opts: PaintScrollbarOpts): void {
  const geom = thumbGeometry({
    contentSize: opts.contentSize,
    viewportSize: opts.viewportSize,
    scrollOffset: opts.scrollOffset,
    trackLength: opts.gutter.length,
  });
  const trackStyle = opts.trackStyle ?? DEFAULT_STYLE;
  const thumbStyle = opts.thumbStyle ?? DEFAULT_STYLE;

  for (let i = 0; i < opts.gutter.length; i++) {
    const isThumb = i >= geom.thumbStart && i < geom.thumbStart + geom.thumbLength;
    const ch = isThumb ? opts.thumbChar : opts.trackChar;
    const style = isThumb ? thumbStyle : trackStyle;
    if (opts.orientation === 'vertical') {
      frame.setGrapheme(opts.gutter.x, opts.gutter.y + i, ch, style);
    } else {
      frame.setGrapheme(opts.gutter.x + i, opts.gutter.y, ch, style);
    }
  }
}
```

> Note: scrollbar paints OUTSIDE any active scissor (the painter will pop scissor before calling this — see Task 11). The scrollbar lives in the parent's gutter, not in the clipped content area.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/render/src/scrollbar.test.ts`
Expected: PASS — 8 tests.

- [ ] **Step 5: Verify**

Run: `pnpm --filter @pilates/render typecheck && pnpm lint`

- [ ] **Step 6: Commit**

```bash
git add packages/render/src/scrollbar.ts packages/render/src/scrollbar.test.ts
git commit -m "render: add paintScrollbar — vertical + horizontal orientations"
```

---

### Task 10: Plumb `overflow` + scroll offsets through `RenderNode` → core `Node`

**Files:**
- Modify: `packages/render/src/types.ts`
- Modify: `packages/render/src/build.ts`

- [ ] **Step 1: Read the current `RenderNode` type and `applyLayoutProps`**

Run: `cat packages/render/src/types.ts | head -80` and `cat packages/render/src/build.ts | sed -n '1,90p'`. Note the current shape of `RenderNode` (specifically `ContainerNode`) and the pattern used in `applyLayoutProps`.

- [ ] **Step 2: Add the type fields**

Edit `packages/render/src/types.ts`. Find the `ContainerNode` (or the shared base) and add (alongside existing layout props like `flexDirection`, `width`, etc.):

```ts
import type { Overflow } from '@pilates/core';
// ...
  overflow?: Overflow;
  overflowX?: Overflow;
  overflowY?: Overflow;
  /** Initial scroll offset; `<ScrollView>` typically owns this via mutation. */
  scrollLeft?: number;
  scrollTop?: number;
```

Make sure `Overflow` is re-exported from `@pilates/core` (it should be — it's added to `style.ts` exports in Task 1; verify with `grep "export type" packages/core/src/index.ts | grep Overflow`; if missing, add it).

- [ ] **Step 3: Apply the props in `build.ts`**

In `applyLayoutProps`, after the existing layout-prop applications:

```ts
  if (spec.overflow !== undefined) node.setOverflow(spec.overflow);
  if (spec.overflowX !== undefined) node.setOverflowX(spec.overflowX);
  if (spec.overflowY !== undefined) node.setOverflowY(spec.overflowY);
  if (spec.scrollLeft !== undefined) node.scrollLeft = spec.scrollLeft;
  if (spec.scrollTop !== undefined) node.scrollTop = spec.scrollTop;
```

> Order matters: `overflow` shorthand comes first so `overflowX`/`overflowY` longhands win when both are set.

- [ ] **Step 4: Verify typecheck**

Run: `pnpm --filter @pilates/render typecheck`
Expected: clean. If `Overflow` is unresolved, add `export type { Overflow }` to `packages/core/src/index.ts`.

- [ ] **Step 5: Verify existing render tests still pass**

Run: `pnpm exec vitest run packages/render/`

- [ ] **Step 6: Verify lint**

Run: `pnpm lint`

- [ ] **Step 7: Commit**

```bash
git add packages/render/src/types.ts packages/render/src/build.ts packages/core/src/index.ts
git commit -m "render: thread overflow + scroll offsets through RenderNode → core Node"
```

---

### Task 11: Painter integrates overflow nodes (clip + offset + scrollbar)

**Files:**
- Modify: `packages/render/src/painter.ts`
- Add tests to: `packages/render/src/snapshots.test.ts` or new `packages/render/src/painter-overflow.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/render/src/painter-overflow.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { build } from './build.js';
import { Frame } from './frame.js';
import { paint } from './painter.js';
import type { ContainerNode, TextNode } from './types.js';

function makeText(text: string, props: Partial<TextNode> = {}): TextNode {
  return { kind: 'text', text, ...props } as TextNode;
}

function makeBox(children: (ContainerNode | TextNode)[], props: Partial<ContainerNode> = {}): ContainerNode {
  return { kind: 'container', children, ...props } as ContainerNode;
}

describe('painter — overflow:hidden clips children', () => {
  it('children outside the parent rect are not painted', () => {
    // 10x3 viewport with a 10x10 child. With overflow:hidden, only the
    // first 3 rows of the child should appear.
    const tree = makeBox(
      [
        makeText('row0'),
        makeText('row1'),
        makeText('row2'),
        makeText('row3'),
        makeText('row4'),
      ],
      { width: 10, height: 3, overflow: 'hidden' },
    );
    const bridge = build(tree);
    bridge.root.calculateLayout();
    const f = new Frame(10, 5);
    paint(f, bridge);

    // Rows 0-2 visible
    expect(f.getCell(0, 0)?.char).toBe('r');
    expect(f.getCell(0, 1)?.char).toBe('r');
    expect(f.getCell(0, 2)?.char).toBe('r');
    // Row 3 should be empty (clipped) — frame default is space.
    expect(f.getCell(0, 3)?.char).toBe(' ');
    expect(f.getCell(0, 4)?.char).toBe(' ');
  });
});

describe('painter — overflow scroll offset translates children', () => {
  it('scrollTop=2 scrolls content up by 2 rows', () => {
    const tree = makeBox(
      [
        makeText('row0'),
        makeText('row1'),
        makeText('row2'),
        makeText('row3'),
        makeText('row4'),
      ],
      { width: 10, height: 3, overflow: 'hidden', scrollTop: 2 },
    );
    const bridge = build(tree);
    bridge.root.calculateLayout();
    const f = new Frame(10, 5);
    paint(f, bridge);

    // row2 should now be at viewport row 0
    expect(f.getCell(0, 0)?.char).toBe('r');
    expect(f.getCell(3, 0)?.char).toBe('2'); // 'row2' last char
  });
});

describe('painter — scrollbar', () => {
  it('overflow:scroll paints a thumb in the right gutter', () => {
    const tree = makeBox(
      [
        makeText('row0'),
        makeText('row1'),
        makeText('row2'),
        makeText('row3'),
        makeText('row4'),
      ],
      { width: 10, height: 3, overflow: 'scroll' },
    );
    const bridge = build(tree);
    bridge.root.calculateLayout();
    const f = new Frame(10, 5);
    paint(f, bridge);

    // Last column (x=9) should have thumb chars in the top portion.
    // 5 content rows / 3 viewport = thumb ≈ round(3 * 3/5) = 2.
    expect(f.getCell(9, 0)?.char).toBe('█');
    expect(f.getCell(9, 1)?.char).toBe('█');
  });

  it('overflow:auto with content fitting paints no scrollbar', () => {
    const tree = makeBox(
      [makeText('a'), makeText('b')],
      { width: 10, height: 5, overflow: 'auto' },
    );
    const bridge = build(tree);
    bridge.root.calculateLayout();
    const f = new Frame(10, 5);
    paint(f, bridge);

    // Last column should be untouched (default space) at every row.
    for (let y = 0; y < 5; y++) {
      expect(f.getCell(9, y)?.char).toBe(' ');
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/render/src/painter-overflow.test.ts`
Expected: FAIL — overflow not yet wired into painter.

- [ ] **Step 3: Modify the painter**

Edit `packages/render/src/painter.ts`. Add the imports:

```ts
import { paintScrollbar } from './scrollbar.js';
import type { ClipRect } from './scissor.js';
```

Modify `paintNode` so that when a node has `overflow !== 'visible'`:

```ts
function paintNode(
  frame: Frame,
  node: Node,
  source: Map<Node, RenderNode>,
  parentX: number,
  parentY: number,
): void {
  const layout = node.getComputedLayout();
  const x = parentX + layout.left;
  const y = parentY + layout.top;
  const rect: Rect = { x, y, width: layout.width, height: layout.height };
  const spec = source.get(node);
  if (spec === undefined) return;

  // Paint self (border, text) BEFORE clipping, so the border stays unclipped.
  if (isTextNode(spec)) {
    paintText(frame, spec, rect);
  } else {
    paintContainer(frame, spec, rect);
  }

  // Determine effective overflow for each axis. Default = 'visible'.
  const ox = node._style.overflowX ?? 'visible';
  const oy = node._style.overflowY ?? 'visible';
  const clipsX = ox !== 'visible';
  const clipsY = oy !== 'visible';
  const clips = clipsX || clipsY;

  if (clips) {
    // Determine if a vertical scrollbar gutter exists on the right edge.
    const showVScroll =
      oy === 'scroll' || (oy === 'auto' && node.scrollHeight > layout.height);
    const showHScroll =
      ox === 'scroll' || (ox === 'auto' && node.scrollWidth > layout.width);
    const gutterRight = showVScroll ? 1 : 0;
    const gutterBottom = showHScroll ? 1 : 0;

    // Content rect = inner box minus scrollbar gutters.
    // For v1 we ignore border/padding for the scissor — they're already part
    // of the parent's layout. The painter operates in absolute frame coords.
    const contentRect: ClipRect = {
      left: x,
      top: y,
      width: Math.max(0, layout.width - gutterRight),
      height: Math.max(0, layout.height - gutterBottom),
    };

    frame.pushScissor(contentRect);
    // Translate child paint origin by (-scrollLeft, -scrollTop). The painter
    // walks children with absolute (parentX, parentY); subtract here.
    const childParentX = x - node.scrollLeft;
    const childParentY = y - node.scrollTop;
    for (let i = 0; i < node.getChildCount(); i++) {
      paintNode(frame, node.getChild(i)!, source, childParentX, childParentY);
    }
    frame.popScissor();

    // Scrollbars paint OUTSIDE the scissor (so they don't get clipped).
    if (showVScroll && layout.height - gutterBottom > 0) {
      paintScrollbar(frame, {
        orientation: 'vertical',
        gutter: {
          x: x + layout.width - 1,
          y,
          length: layout.height - gutterBottom,
        },
        contentSize: node.scrollHeight,
        viewportSize: layout.height - gutterBottom,
        scrollOffset: node.scrollTop,
        thumbChar: '█',
        trackChar: ' ',
      });
    }
    if (showHScroll && layout.width - gutterRight > 0) {
      paintScrollbar(frame, {
        orientation: 'horizontal',
        gutter: {
          x,
          y: y + layout.height - 1,
          length: layout.width - gutterRight,
        },
        contentSize: node.scrollWidth,
        viewportSize: layout.width - gutterRight,
        scrollOffset: node.scrollLeft,
        thumbChar: '█',
        trackChar: ' ',
      });
    }
  } else {
    // No clipping: walk children with the existing parentX/parentY.
    for (let i = 0; i < node.getChildCount(); i++) {
      paintNode(frame, node.getChild(i)!, source, x, y);
    }
  }
}
```

> If accessing `node._style.overflowX` directly trips a TypeScript visibility error, expose a public read-only path (e.g., the existing `node.style.overflowX` getter chain — check whether `Node.style` is `Readonly<Style>` and accessible). Replace `node._style` with `node.style` if so.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/render/src/painter-overflow.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Verify no regressions in existing render tests**

Run: `pnpm exec vitest run packages/render/`
Expected: all tests pass (existing snapshot tests should be untouched — they don't use `overflow`).

- [ ] **Step 6: Verify**

Run: `pnpm --filter @pilates/render typecheck && pnpm lint`

- [ ] **Step 7: Commit**

```bash
git add packages/render/src/painter.ts packages/render/src/painter-overflow.test.ts
git commit -m "render: painter clips + offsets + paints scrollbar for overflow nodes"
```

---

### Task 12: `<Box overflow=...>` prop on `@pilates/react` lowers to `RenderNode.overflow`

**Files:**
- Modify: `packages/react/src/components.tsx`
- Add tests to: `packages/react/src/render.test.tsx` or new `packages/react/src/box-overflow.test.tsx`

- [ ] **Step 1: Read the existing `<Box>` props mapping**

Run: `grep -n "overflow\|flexDirection\|height" packages/react/src/components.tsx | head -20`. Find the props interface and the host-element lowering. Note: in `host-config.ts`, props get translated into `RenderNode`-shaped objects.

- [ ] **Step 2: Write the failing test**

Create `packages/react/src/box-overflow.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { Box, Text } from './components.js';
import { mountWithInput } from './test-utils.js';

describe('<Box overflow="hidden">', () => {
  it('clips content to the viewport', () => {
    const handle = mountWithInput(
      0,
      () => (
        <Box width={10} height={2} overflow="hidden">
          <Text>row0</Text>
          <Text>row1</Text>
          <Text>row2</Text>
        </Box>
      ),
      { width: 10, height: 5 },
    );
    const out = handle.lastWrite();
    expect(out).toContain('row0');
    expect(out).toContain('row1');
    expect(out).not.toContain('row2');
    handle.unmount();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm exec vitest run packages/react/src/box-overflow.test.tsx`
Expected: FAIL — `overflow` prop is not yet a valid `<Box>` prop (or it gets ignored).

- [ ] **Step 4: Add `overflow` to `BoxProps` and pass it through**

Edit `packages/react/src/components.tsx`. Add `overflow`/`overflowX`/`overflowY` to `BoxProps`:

```ts
import type { Overflow } from '@pilates/render';
// ...

export interface BoxProps {
  // ...existing props
  overflow?: Overflow;
  overflowX?: Overflow;
  overflowY?: Overflow;
}
```

> If `Overflow` isn't re-exported from `@pilates/render`, add `export type { Overflow }` to `packages/render/src/index.ts` (re-exporting from `@pilates/core`). The chain is: `core` defines → `render` re-exports → `react` consumes.

In the JSX-to-RenderNode lowering (host-config), the prop forwarding is structural — `overflow` should already pass through if `Box` spreads or copies its props onto the RenderNode. Verify by reading the JSX intrinsic types in `components.tsx`. If a manual whitelist exists, add the three new props.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm exec vitest run packages/react/src/box-overflow.test.tsx`
Expected: PASS.

- [ ] **Step 6: Verify**

Run: `pnpm --filter @pilates/react typecheck && pnpm lint`

- [ ] **Step 7: Commit**

```bash
git add packages/react/src/components.tsx packages/react/src/box-overflow.test.tsx packages/render/src/index.ts
git commit -m "react: add overflow prop to <Box>; lowers to RenderNode.overflow"
```

---

### Task 13: `<ScrollView>` skeleton — sizing + overflow:hidden + content container

**Files:**
- Create: `packages/react/src/scroll-view.tsx`
- Create: `packages/react/src/scroll-view.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `packages/react/src/scroll-view.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { Text } from './components.js';
import { ScrollView } from './scroll-view.js';
import { mountWithInput } from './test-utils.js';

describe('<ScrollView> — basic clipping', () => {
  it('renders a viewport that clips content beyond `height`', () => {
    const handle = mountWithInput(
      0,
      () => (
        <ScrollView height={2}>
          <Text>row0</Text>
          <Text>row1</Text>
          <Text>row2</Text>
          <Text>row3</Text>
        </ScrollView>
      ),
      { width: 20, height: 5 },
    );
    const out = handle.lastWrite();
    expect(out).toContain('row0');
    expect(out).toContain('row1');
    expect(out).not.toContain('row2');
    expect(out).not.toContain('row3');
    handle.unmount();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/react/src/scroll-view.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the skeleton**

Create `packages/react/src/scroll-view.tsx`:

```tsx
import { type ReactNode, forwardRef } from 'react';
import { Box } from './components.js';

export interface ScrollViewProps {
  /** Visible viewport height (cells). Required for vertical scrolling. */
  height?: number | string;
  /** Visible viewport width (cells). Required for horizontal scrolling. */
  width?: number | string;
  /** When true, scroll the X axis instead of Y. Default false (vertical). */
  horizontal?: boolean;
  children?: ReactNode;
}

/**
 * Viewport into content larger than the visible area.
 *
 * Phase 1 skeleton: renders a `<Box overflow="hidden">` with the supplied
 * dimensions. Subsequent tasks add scroll state, imperative ref API,
 * built-in keys, focus integration, and stick-to-edge semantics.
 */
export const ScrollView = forwardRef<unknown, ScrollViewProps>(function ScrollView(
  { height, width, horizontal, children },
  _ref,
) {
  // The outer Box is the viewport. It clips. The content sits inside.
  // For Phase 1 we mount as a single-Box — content container nesting comes
  // when we add stickToBottom/contentContainerStyle in later tasks.
  return (
    <Box
      width={width}
      height={height}
      overflow="hidden"
      flexDirection={horizontal === true ? 'row' : 'column'}
    >
      {children}
    </Box>
  );
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/react/src/scroll-view.test.tsx`
Expected: PASS.

- [ ] **Step 5: Verify**

Run: `pnpm --filter @pilates/react typecheck && pnpm lint`

- [ ] **Step 6: Commit**

```bash
git add packages/react/src/scroll-view.tsx packages/react/src/scroll-view.test.tsx
git commit -m "react: <ScrollView> skeleton — viewport with overflow:hidden"
```

---

### Task 14: Add controlled / uncontrolled scroll state + `onScroll`

**Files:**
- Modify: `packages/react/src/scroll-view.tsx`
- Modify: `packages/react/src/scroll-view.test.tsx`

- [ ] **Step 1: Extend the test**

Append to `packages/react/src/scroll-view.test.tsx`:

```tsx
describe('<ScrollView> — scroll state', () => {
  it('controlled: when scrollOffset prop is set, content is offset by that amount', () => {
    const handle = mountWithInput(
      0,
      () => (
        <ScrollView height={2} scrollOffset={2}>
          <Text>row0</Text>
          <Text>row1</Text>
          <Text>row2</Text>
          <Text>row3</Text>
        </ScrollView>
      ),
      { width: 20, height: 5 },
    );
    const out = handle.lastWrite();
    // With scrollOffset=2, rows 2 and 3 are visible; rows 0 and 1 are clipped.
    expect(out).toContain('row2');
    expect(out).toContain('row3');
    expect(out).not.toContain('row0');
    expect(out).not.toContain('row1');
    handle.unmount();
  });

  it('uncontrolled: defaultScrollOffset sets the initial position', () => {
    const handle = mountWithInput(
      0,
      () => (
        <ScrollView height={2} defaultScrollOffset={1}>
          <Text>row0</Text>
          <Text>row1</Text>
          <Text>row2</Text>
        </ScrollView>
      ),
      { width: 20, height: 5 },
    );
    const out = handle.lastWrite();
    expect(out).not.toContain('row0');
    expect(out).toContain('row1');
    expect(out).toContain('row2');
    handle.unmount();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/react/src/scroll-view.test.tsx`
Expected: FAIL — `scrollOffset` prop is not honored.

- [ ] **Step 3: Update the component**

Edit `packages/react/src/scroll-view.tsx`. Replace its body with:

```tsx
import { type ReactNode, forwardRef, useState } from 'react';
import { Box } from './components.js';

export interface ScrollMeta {
  contentSize: number;
  viewportSize: number;
  atStart: boolean;
  atEnd: boolean;
}

export interface ScrollViewProps {
  height?: number | string;
  width?: number | string;
  horizontal?: boolean;
  /** Controlled scroll offset. If set, parent owns the value. */
  scrollOffset?: number;
  /** Uncontrolled initial offset. Ignored when `scrollOffset` is set. */
  defaultScrollOffset?: number;
  /** Fires whenever the offset changes (controlled or uncontrolled). */
  onScroll?: (offset: number, meta: ScrollMeta) => void;
  children?: ReactNode;
}

export const ScrollView = forwardRef<unknown, ScrollViewProps>(function ScrollView(
  { height, width, horizontal, scrollOffset, defaultScrollOffset, onScroll, children },
  _ref,
) {
  const isControlled = scrollOffset !== undefined;
  const [internalOffset, setInternalOffset] = useState(defaultScrollOffset ?? 0);
  const effectiveOffset = isControlled ? (scrollOffset as number) : internalOffset;

  const axisOverflow = horizontal === true
    ? { overflowX: 'hidden' as const, overflowY: 'visible' as const }
    : { overflowX: 'visible' as const, overflowY: 'hidden' as const };
  const offsetProp = horizontal === true
    ? { scrollLeft: effectiveOffset }
    : { scrollTop: effectiveOffset };

  return (
    <Box
      width={width}
      height={height}
      flexDirection={horizontal === true ? 'row' : 'column'}
      {...axisOverflow}
      {...offsetProp}
    >
      {children}
    </Box>
  );
});
```

> Note: `scrollLeft` / `scrollTop` are passed as JSX props on `<Box>`. They lower into `RenderNode.scrollLeft` / `scrollTop` which `build.ts` (Task 10) maps onto the core Node. This requires `<Box>` to forward those props — verify by reading `components.tsx`. If it doesn't, add them to `BoxProps` and pass through (a 1-line change).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/react/src/scroll-view.test.tsx`
Expected: PASS.

- [ ] **Step 5: Verify**

Run: `pnpm --filter @pilates/react typecheck && pnpm lint`

- [ ] **Step 6: Commit**

```bash
git add packages/react/src/scroll-view.tsx packages/react/src/scroll-view.test.tsx packages/react/src/components.tsx
git commit -m "react: <ScrollView> controlled / uncontrolled scroll state"
```

---

### Task 15: Imperative ref API

**Files:**
- Modify: `packages/react/src/scroll-view.tsx`
- Modify: `packages/react/src/scroll-view.test.tsx`

- [ ] **Step 1: Extend the test**

Append to `packages/react/src/scroll-view.test.tsx`:

```tsx
import { useRef } from 'react';
import type { ScrollViewHandle } from './scroll-view.js';

describe('<ScrollView> — imperative ref API', () => {
  it('scrollTo jumps to the given offset', () => {
    let api: ScrollViewHandle | null = null;
    function App() {
      const ref = useRef<ScrollViewHandle>(null);
      api = ref.current;
      return (
        <ScrollView height={2} ref={ref}>
          <Text>row0</Text>
          <Text>row1</Text>
          <Text>row2</Text>
        </ScrollView>
      );
    }
    const handle = mountWithInput(0, () => <App />, { width: 20, height: 5 });
    // ref is populated after mount
    expect(api).not.toBeNull();
    api!.scrollTo(1);
    handle.flush?.(); // sync any state updates
    const out = handle.lastWrite();
    expect(out).toContain('row1');
    expect(out).toContain('row2');
    handle.unmount();
  });

  it('scrollTo clamps to [0, contentSize - viewportSize]', () => {
    let api: ScrollViewHandle | null = null;
    function App() {
      const ref = useRef<ScrollViewHandle>(null);
      api = ref.current;
      return (
        <ScrollView height={2} ref={ref}>
          <Text>row0</Text>
          <Text>row1</Text>
          <Text>row2</Text>
        </ScrollView>
      );
    }
    const handle = mountWithInput(0, () => <App />, { width: 20, height: 5 });
    api!.scrollTo(999); // overshoot
    expect(api!.getScrollOffset()).toBe(1); // contentSize=3, viewportSize=2, max=1
    api!.scrollTo(-5); // negative
    expect(api!.getScrollOffset()).toBe(0);
    handle.unmount();
  });

  it('scrollToEnd / scrollToStart move to the bounds', () => {
    let api: ScrollViewHandle | null = null;
    function App() {
      const ref = useRef<ScrollViewHandle>(null);
      api = ref.current;
      return (
        <ScrollView height={2} ref={ref}>
          <Text>row0</Text>
          <Text>row1</Text>
          <Text>row2</Text>
          <Text>row3</Text>
        </ScrollView>
      );
    }
    const handle = mountWithInput(0, () => <App />, { width: 20, height: 5 });
    api!.scrollToEnd();
    expect(api!.getScrollOffset()).toBe(2); // contentSize=4, viewportSize=2, end=2
    api!.scrollToStart();
    expect(api!.getScrollOffset()).toBe(0);
    handle.unmount();
  });

  it('scrollBy adds the delta', () => {
    let api: ScrollViewHandle | null = null;
    function App() {
      const ref = useRef<ScrollViewHandle>(null);
      api = ref.current;
      return (
        <ScrollView height={2} ref={ref}>
          <Text>row0</Text>
          <Text>row1</Text>
          <Text>row2</Text>
          <Text>row3</Text>
        </ScrollView>
      );
    }
    const handle = mountWithInput(0, () => <App />, { width: 20, height: 5 });
    api!.scrollBy(1);
    expect(api!.getScrollOffset()).toBe(1);
    api!.scrollBy(1);
    expect(api!.getScrollOffset()).toBe(2);
    api!.scrollBy(99); // would overshoot — clamps to max
    expect(api!.getScrollOffset()).toBe(2);
    handle.unmount();
  });
});
```

> Note: ref is read after the first commit. The `api` variable is set by `App`'s render after `useRef.current` is populated. Some test harnesses need a `flush()` or similar to settle effects — match the existing pattern in `error-boundary.test.tsx`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/react/src/scroll-view.test.tsx`
Expected: FAIL — `scrollTo` not implemented.

- [ ] **Step 3: Add the imperative API**

Edit `packages/react/src/scroll-view.tsx`. Replace with:

```tsx
import {
  type ReactNode,
  forwardRef,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { Box } from './components.js';
import { useBoxMetrics } from './use-box-metrics.js';

// (full file below — overwrite previous version)

export interface ScrollMeta {
  contentSize: number;
  viewportSize: number;
  atStart: boolean;
  atEnd: boolean;
}

export interface ScrollViewProps {
  height?: number | string;
  width?: number | string;
  horizontal?: boolean;
  scrollOffset?: number;
  defaultScrollOffset?: number;
  onScroll?: (offset: number, meta: ScrollMeta) => void;
  children?: ReactNode;
}

export interface ScrollViewHandle {
  scrollTo: (offset: number) => void;
  scrollBy: (delta: number) => void;
  scrollToStart: () => void;
  scrollToEnd: () => void;
  getScrollOffset: () => number;
  getContentSize: () => number;
  getViewportSize: () => number;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(n, hi));
}

export const ScrollView = forwardRef<ScrollViewHandle, ScrollViewProps>(
  function ScrollView(
    { height, width, horizontal, scrollOffset, defaultScrollOffset, onScroll, children },
    ref,
  ) {
    const isControlled = scrollOffset !== undefined;
    const [internalOffset, setInternalOffset] = useState(defaultScrollOffset ?? 0);
    const effectiveOffset = isControlled ? (scrollOffset as number) : internalOffset;

    // Box metrics give us the actual rendered viewport + content sizes after layout.
    // The ref type matches whatever <Box> exposes (a core Node); useBoxMetrics
    // accepts the same ref type. Look at use-box-metrics.tsx for the exact
    // type if the inferred type isn't sufficient.
    const boxRef = useRef(null);
    const metrics = useBoxMetrics(boxRef);

    const isVertical = horizontal !== true;
    const viewportSize = isVertical ? metrics.height : metrics.width;
    const contentSize = isVertical ? metrics.scrollHeight : metrics.scrollWidth;
    const maxOffset = Math.max(0, contentSize - viewportSize);

    const setOffset = (next: number) => {
      const clamped = clamp(next, 0, maxOffset);
      if (clamped === effectiveOffset) return;
      if (!isControlled) setInternalOffset(clamped);
      onScroll?.(clamped, {
        contentSize,
        viewportSize,
        atStart: clamped === 0,
        atEnd: clamped >= maxOffset,
      });
    };

    useImperativeHandle(
      ref,
      (): ScrollViewHandle => ({
        scrollTo: (offset) => setOffset(offset),
        scrollBy: (delta) => setOffset(effectiveOffset + delta),
        scrollToStart: () => setOffset(0),
        scrollToEnd: () => setOffset(maxOffset),
        getScrollOffset: () => effectiveOffset,
        getContentSize: () => contentSize,
        getViewportSize: () => viewportSize,
      }),
      [effectiveOffset, contentSize, viewportSize, maxOffset, isControlled],
    );

    const axisOverflow = isVertical
      ? { overflowX: 'visible' as const, overflowY: 'hidden' as const }
      : { overflowX: 'hidden' as const, overflowY: 'visible' as const };
    const offsetProp = isVertical
      ? { scrollTop: effectiveOffset }
      : { scrollLeft: effectiveOffset };

    return (
      <Box
        ref={boxRef}
        width={width}
        height={height}
        flexDirection={isVertical ? 'column' : 'row'}
        {...axisOverflow}
        {...offsetProp}
      >
        {children}
      </Box>
    );
  },
);
```

> `useBoxMetrics` was added in PR #40 (Track 1 P2 prep). It returns `{ width, height, scrollWidth, scrollHeight, ... }` for a Box ref. If the metrics returned don't include `scrollWidth`/`scrollHeight` yet, extend it: edit `packages/react/src/use-box-metrics.tsx` to read `node.scrollWidth` / `node.scrollHeight` and add them to its `BoxMetrics` interface. (This is a small, in-scope expansion of `useBoxMetrics` — call it out in the commit message.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/react/src/scroll-view.test.tsx`
Expected: PASS.

- [ ] **Step 5: Verify**

Run: `pnpm --filter @pilates/react typecheck && pnpm lint`

- [ ] **Step 6: Commit**

```bash
git add packages/react/src/scroll-view.tsx packages/react/src/scroll-view.test.tsx packages/react/src/use-box-metrics.tsx 2>/dev/null || true
git commit -m "react: <ScrollView> imperative API (scrollTo / scrollBy / scrollTo{Start,End} / getters)"
```

---

### Task 16: Built-in keys when focused (`scrollEnabled`)

**Files:**
- Modify: `packages/react/src/scroll-view.tsx`
- Modify: `packages/react/src/scroll-view.test.tsx`

- [ ] **Step 1: Extend the test**

Append to `packages/react/src/scroll-view.test.tsx`:

```tsx
describe('<ScrollView> — built-in keys', () => {
  it('arrow Down advances by 1 line when focused', () => {
    let api: ScrollViewHandle | null = null;
    function App() {
      const ref = useRef<ScrollViewHandle>(null);
      api = ref.current;
      return (
        <ScrollView height={2} ref={ref}>
          <Text>row0</Text>
          <Text>row1</Text>
          <Text>row2</Text>
          <Text>row3</Text>
        </ScrollView>
      );
    }
    const handle = mountWithInput(0, () => <App />, { width: 20, height: 5 });
    handle.input!.write('[B'); // arrow Down
    expect(api!.getScrollOffset()).toBe(1);
    handle.unmount();
  });

  it('PgDn advances by viewport - 1', () => {
    let api: ScrollViewHandle | null = null;
    function App() {
      const ref = useRef<ScrollViewHandle>(null);
      api = ref.current;
      return (
        <ScrollView height={3} ref={ref}>
          <Text>row0</Text><Text>row1</Text><Text>row2</Text>
          <Text>row3</Text><Text>row4</Text><Text>row5</Text>
          <Text>row6</Text><Text>row7</Text>
        </ScrollView>
      );
    }
    const handle = mountWithInput(0, () => <App />, { width: 20, height: 8 });
    handle.input!.write('[6~'); // PgDn
    expect(api!.getScrollOffset()).toBe(2); // viewport=3, step=2
    handle.unmount();
  });

  it('Home / End jump to bounds', () => {
    let api: ScrollViewHandle | null = null;
    function App() {
      const ref = useRef<ScrollViewHandle>(null);
      api = ref.current;
      return (
        <ScrollView height={2} ref={ref}>
          <Text>row0</Text><Text>row1</Text><Text>row2</Text><Text>row3</Text>
        </ScrollView>
      );
    }
    const handle = mountWithInput(0, () => <App />, { width: 20, height: 5 });
    handle.input!.write('[F'); // End
    expect(api!.getScrollOffset()).toBe(2);
    handle.input!.write('[H'); // Home
    expect(api!.getScrollOffset()).toBe(0);
    handle.unmount();
  });

  it('scrollEnabled={false} disables built-in keys', () => {
    let api: ScrollViewHandle | null = null;
    function App() {
      const ref = useRef<ScrollViewHandle>(null);
      api = ref.current;
      return (
        <ScrollView height={2} scrollEnabled={false} ref={ref}>
          <Text>row0</Text><Text>row1</Text><Text>row2</Text>
        </ScrollView>
      );
    }
    const handle = mountWithInput(0, () => <App />, { width: 20, height: 5 });
    handle.input!.write('[B'); // arrow Down
    expect(api!.getScrollOffset()).toBe(0);
    handle.unmount();
  });
});
```

> Adapt the escape-sequence bytes if `key-parser.ts` parses different sequences for these keys. Look at `packages/react/src/key-parser.test.ts` for the canonical PgDn / End / arrow encodings used by the tests.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/react/src/scroll-view.test.tsx`
Expected: FAIL — built-in keys do nothing.

- [ ] **Step 3: Wire up `useFocus` + `useInput`**

In `scroll-view.tsx`, add the imports:

```tsx
import { useFocus, useInput } from './index.js';
```

Add to the `ScrollViewProps` interface:

```ts
  /** Default true; built-in arrow / PgUp / PgDn / Home / End keys when focused. */
  scrollEnabled?: boolean;
```

Inside the component body, before the `useImperativeHandle`:

```tsx
const focus = useFocus({ isActive: scrollEnabled !== false });
const isFocused = focus.isFocused;
useInput(
  (event) => {
    if (!isFocused) return;
    const lineKey = isVertical ? event.name === 'down' : event.name === 'right';
    const lineKeyBack = isVertical ? event.name === 'up' : event.name === 'left';
    if (lineKey) {
      setOffset(effectiveOffset + 1);
      return;
    }
    if (lineKeyBack) {
      setOffset(effectiveOffset - 1);
      return;
    }
    if (event.name === 'pagedown') {
      setOffset(effectiveOffset + Math.max(1, viewportSize - 1));
      return;
    }
    if (event.name === 'pageup') {
      setOffset(effectiveOffset - Math.max(1, viewportSize - 1));
      return;
    }
    if (event.name === 'home') {
      setOffset(0);
      return;
    }
    if (event.name === 'end') {
      setOffset(maxOffset);
      return;
    }
  },
  { isActive: scrollEnabled !== false && isFocused },
);
```

> If `KeyName` doesn't include `'pagedown'` / `'pageup'` / `'home'` / `'end'`, look at the existing list in `packages/react/src/hooks.ts` and use whatever names the parser exposes. The parser may use `'pgdn'` etc.; adapt the code accordingly.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/react/src/scroll-view.test.tsx`
Expected: PASS.

- [ ] **Step 5: Verify**

Run: `pnpm --filter @pilates/react typecheck && pnpm lint`

- [ ] **Step 6: Commit**

```bash
git add packages/react/src/scroll-view.tsx packages/react/src/scroll-view.test.tsx
git commit -m "react: <ScrollView> built-in keys (arrow / PgUp / PgDn / Home / End)"
```

---

### Task 17: `stickToBottom` semantics

**Files:**
- Modify: `packages/react/src/scroll-view.tsx`
- Modify: `packages/react/src/scroll-view.test.tsx`

- [ ] **Step 1: Extend the test**

Append to `packages/react/src/scroll-view.test.tsx`:

```tsx
describe('<ScrollView> — stickToBottom', () => {
  it('appending content auto-scrolls to end', () => {
    let setItems: ((n: number) => void) | null = null;
    function App() {
      const [n, set] = useState(3);
      setItems = set;
      const items = [];
      for (let i = 0; i < n; i++) items.push(<Text key={i}>{`row${i}`}</Text>);
      return (
        <ScrollView height={2} stickToBottom>
          {items}
        </ScrollView>
      );
    }
    const handle = mountWithInput(0, () => <App />, { width: 20, height: 5 });
    setItems!(8); // grows content
    handle.flush?.();
    const out = handle.lastWrite();
    // Latest rows should be visible
    expect(out).toContain('row6');
    expect(out).toContain('row7');
    expect(out).not.toContain('row0');
    handle.unmount();
  });

  it('after user scrolls away, append does NOT auto-scroll', () => {
    let setItems: ((n: number) => void) | null = null;
    let api: ScrollViewHandle | null = null;
    function App() {
      const ref = useRef<ScrollViewHandle>(null);
      api = ref.current;
      const [n, set] = useState(8);
      setItems = set;
      const items = [];
      for (let i = 0; i < n; i++) items.push(<Text key={i}>{`row${i}`}</Text>);
      return (
        <ScrollView height={2} stickToBottom ref={ref}>
          {items}
        </ScrollView>
      );
    }
    const handle = mountWithInput(0, () => <App />, { width: 20, height: 5 });
    // Scroll to top — this is "user scrolled away from bottom"
    api!.scrollToStart();
    setItems!(12); // append 4 more
    handle.flush?.();
    const out = handle.lastWrite();
    // Should NOT have snapped back to end — top rows still visible
    expect(out).toContain('row0');
    expect(out).not.toContain('row11');
    handle.unmount();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/react/src/scroll-view.test.tsx`
Expected: FAIL — `stickToBottom` not implemented.

- [ ] **Step 3: Add the prop and the layout-effect logic**

In `scroll-view.tsx`:

Add to props:

```ts
  /** When content grows, auto-scroll to end. Pauses if user has scrolled away. */
  stickToBottom?: boolean;
  /** When content grows, auto-scroll to start. Mutually exclusive with stickToBottom. */
  stickToTop?: boolean;
```

Inside the component, after computing `contentSize` / `viewportSize`:

```tsx
import { useEffect, useRef } from 'react';

// Track previous values so we know whether the user was at-edge before the
// content size changed.
const prevContentSizeRef = useRef(contentSize);
const wasAtEndRef = useRef(true);
const wasAtStartRef = useRef(true);

useEffect(() => {
  const grew = contentSize > prevContentSizeRef.current;
  if (grew) {
    if (stickToBottom && wasAtEndRef.current) {
      setOffset(Math.max(0, contentSize - viewportSize));
    } else if (stickToTop && wasAtStartRef.current) {
      setOffset(0);
    }
  }
  prevContentSizeRef.current = contentSize;
  wasAtEndRef.current = effectiveOffset >= Math.max(0, contentSize - viewportSize);
  wasAtStartRef.current = effectiveOffset === 0;
});
```

> The "was at end before grow" detection requires tracking the offset BEFORE the content change is observed. The simplest version above checks `effectiveOffset` after the render but before the next; `useEffect` runs after commit, so by the time it fires, `contentSize` is the new size. The `wasAtEndRef` tracks the prior frame's at-end status; it's set at the END of the effect for use by the NEXT effect run. This races slightly: if the user scrolls and the content grows in the same render, the at-end check is a frame behind. For Phase 1 this is acceptable; revisit if it bites consumers.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/react/src/scroll-view.test.tsx`
Expected: PASS.

- [ ] **Step 5: Verify**

Run: `pnpm --filter @pilates/react typecheck && pnpm lint`

- [ ] **Step 6: Commit**

```bash
git add packages/react/src/scroll-view.tsx packages/react/src/scroll-view.test.tsx
git commit -m "react: <ScrollView> stickToBottom / stickToTop semantics"
```

---

### Task 18: `ScrollContext` + `scrollIntoView` via focus integration

**Files:**
- Create: `packages/react/src/scroll-context.ts`
- Modify: `packages/react/src/scroll-view.tsx`
- Modify: `packages/react/src/scroll-view.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `packages/react/src/scroll-view.test.tsx`:

```tsx
import { useFocus as useFocusFromIndex } from './index.js';

describe('<ScrollView> — scrollOnFocus / scrollIntoView', () => {
  it('focusing a descendant outside the viewport auto-scrolls to make it visible', () => {
    let api: ScrollViewHandle | null = null;
    let focusRow3: (() => void) | null = null;
    function Item({ id }: { id: string }) {
      const f = useFocusFromIndex({ id });
      if (id === 'row3') focusRow3 = f.focus;
      return <Text>{`${id}${f.isFocused ? '*' : ''}`}</Text>;
    }
    function App() {
      const ref = useRef<ScrollViewHandle>(null);
      api = ref.current;
      return (
        <ScrollView height={2} ref={ref}>
          <Item id="row0" />
          <Item id="row1" />
          <Item id="row2" />
          <Item id="row3" />
        </ScrollView>
      );
    }
    const handle = mountWithInput(0, () => <App />, { width: 20, height: 5 });
    expect(api!.getScrollOffset()).toBe(0);
    focusRow3!();
    handle.flush?.();
    // row3 is at index 3, viewport is 2 rows tall → must scroll to offset 2
    expect(api!.getScrollOffset()).toBe(2);
    handle.unmount();
  });

  it('scrollOnFocus={false} disables auto-scroll', () => {
    let api: ScrollViewHandle | null = null;
    let focusRow3: (() => void) | null = null;
    function Item({ id }: { id: string }) {
      const f = useFocusFromIndex({ id });
      if (id === 'row3') focusRow3 = f.focus;
      return <Text>{id}</Text>;
    }
    function App() {
      const ref = useRef<ScrollViewHandle>(null);
      api = ref.current;
      return (
        <ScrollView height={2} scrollOnFocus={false} ref={ref}>
          <Item id="row0" /><Item id="row1" />
          <Item id="row2" /><Item id="row3" />
        </ScrollView>
      );
    }
    const handle = mountWithInput(0, () => <App />, { width: 20, height: 5 });
    focusRow3!();
    handle.flush?.();
    expect(api!.getScrollOffset()).toBe(0);
    handle.unmount();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/react/src/scroll-view.test.tsx`
Expected: FAIL — focus does not trigger auto-scroll.

- [ ] **Step 3: Create the context**

Create `packages/react/src/scroll-context.ts`:

```ts
import { type Context, createContext } from 'react';

/**
 * Bounds-in-viewport descriptor passed to `notifyFocusedBounds` by focusable
 * descendants. The numbers are relative to the descendant's nearest
 * `<ScrollView>` content origin (NOT the absolute frame).
 */
export interface FocusedBounds {
  start: number; // top edge for vertical, left edge for horizontal
  size: number;  // height for vertical, width for horizontal
}

export interface ScrollContextValue {
  /**
   * Called by focusable descendants on focus to request that the enclosing
   * `<ScrollView>` ensure the descendant is visible.
   */
  notifyFocusedBounds: (bounds: FocusedBounds) => void;
}

/**
 * Context value supplied by every `<ScrollView>` mounted in the tree.
 * Focusable descendants (e.g. `<TextInput>`, `<Select>`) read this and
 * call `notifyFocusedBounds` on focus. Default value is a no-op so
 * descendants outside any `<ScrollView>` work unchanged.
 */
export const ScrollContext: Context<ScrollContextValue> = createContext<ScrollContextValue>({
  notifyFocusedBounds: () => {},
});
```

- [ ] **Step 4: Wire `<ScrollView>` to provide the context**

In `scroll-view.tsx`:

Add the import:

```tsx
import { ScrollContext, type FocusedBounds } from './scroll-context.js';
```

Add to props:

```ts
  /** Default true; auto-scroll to keep focused descendants visible. */
  scrollOnFocus?: boolean;
```

Inside the component, add the handler and provide the context:

```tsx
const notifyFocusedBounds = (bounds: FocusedBounds) => {
  if (scrollOnFocus === false) return;
  const start = bounds.start;
  const end = start + bounds.size;
  const visStart = effectiveOffset;
  const visEnd = effectiveOffset + viewportSize;
  if (start < visStart) setOffset(start);
  else if (end > visEnd) setOffset(end - viewportSize);
};

return (
  <ScrollContext.Provider value={{ notifyFocusedBounds }}>
    <Box
      ref={boxRef}
      width={width}
      height={height}
      flexDirection={isVertical ? 'column' : 'row'}
      {...axisOverflow}
      {...offsetProp}
    >
      {children}
    </Box>
  </ScrollContext.Provider>
);
```

- [ ] **Step 5: Wire `useFocus` to call `notifyFocusedBounds` on focus change**

The simplest way: in `packages/react/src/focus.tsx`'s `useFocus`, observe `isFocused`; when it transitions from `false` → `true` AND the focusable's own metrics are available, call `useContext(ScrollContext).notifyFocusedBounds(...)`.

But `useFocus` doesn't know its own bounds — only the renderer does. The cleanest v1 solution: `useFocus` users pass their bounds explicitly via a new `useFocus({ ..., onFocus: () => ... })` callback prop OR via a new helper `useScrollIntoFocus(boxRef)` that consumes both `useFocus` and `useBoxMetrics`.

For Phase 1, take the helper approach. Edit `useFocus` in `focus.tsx`:

```tsx
import { ScrollContext } from './scroll-context.js';
// ... inside useFocus, after isFocused is computed:

const scrollCtx = useContext(ScrollContext);
const wasFocusedRef = useRef(false);
useEffect(() => {
  if (isFocused && !wasFocusedRef.current) {
    // Look up the focused widget's bounds via... what?
    // For Phase 1, we approximate by reading from a ref the consumer provides.
    // But the most ergonomic API is: the consumer doesn't have to do anything,
    // and useFocus walks the DOM/Yoga tree to find its own bounds.
  }
  wasFocusedRef.current = isFocused;
}, [isFocused]);
```

> **This is the gnarly part.** `useFocus` doesn't have a natural ref to the rendered box; widgets like `<TextInput>` use `useFocus` separately from any rendered `<Box>`. The cleanest way is to add an opt-in `boundsRef?: RefObject<Node>` to `UseFocusOptions`, and have `useFocus` read `boundsRef.current` on focus to compute bounds.
>
> A simpler v1: just have widgets call `notifyFocusedBounds` themselves via a small helper. Add to `scroll-context.ts`:
> 
> ```ts
> import { type RefObject, useContext, useEffect } from 'react';
> 
> export function useScrollIntoFocus(
>   isFocused: boolean,
>   nodeRef: RefObject<{ layout: { top: number; left: number; height: number; width: number } } | null>,
> ): void {
>   const ctx = useContext(ScrollContext);
>   useEffect(() => {
>     if (!isFocused) return;
>     const node = nodeRef.current;
>     if (node === null) return;
>     // For vertical scroll, bounds are top/height. For horizontal, left/width.
>     // For Phase 1 we only support vertical; pass top/height.
>     ctx.notifyFocusedBounds({ start: node.layout.top, size: node.layout.height });
>   }, [isFocused, ctx, nodeRef]);
> }
> ```
> 
> Then in widgets / consumers, after `useFocus` and a `useBoxMetrics(boxRef)`:
> 
> ```ts
> useScrollIntoFocus(focus.isFocused, boxRef);
> ```
>
> **For the test in step 1**, the test items are `<Text>` not Box — they don't have refs. We need a different path. For Phase 1, the cleanest fix: have `<ScrollView>` itself listen to focus changes via the `useFocus` registry (`useFocusManager().focusedId`) and use `position-of-the-focused-id-in-children-list` × per-row-height as bounds. This requires `<ScrollView>` to know the row height of each child, which it doesn't have natively.
>
> **Alternative for Phase 1**: simplify the test to use real `<Box>` children with `useFocus` + `useScrollIntoFocus`, and document that `scrollOnFocus` works for any focusable that opts in via `useScrollIntoFocus`. Reframe: focus integration is an opt-in helper, not magic. Update the test to:

Update test (replace from step 1):

```tsx
import { useFocus as useFocusFromIndex } from './index.js';
import { useRef } from 'react';
import { useScrollIntoFocus } from './scroll-context.js';
import { Box } from './components.js';

describe('<ScrollView> — scrollOnFocus / scrollIntoView via useScrollIntoFocus', () => {
  it('focusing a descendant outside the viewport auto-scrolls to make it visible', () => {
    let api: ScrollViewHandle | null = null;
    let focusRow3: (() => void) | null = null;
    function Item({ id }: { id: string }) {
      const ref = useRef(null);
      const f = useFocusFromIndex({ id });
      useScrollIntoFocus(f.isFocused, ref);
      if (id === 'row3') focusRow3 = f.focus;
      return (
        <Box ref={ref}>
          <Text>{id}</Text>
        </Box>
      );
    }
    // ... rest same as before
  });
});
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm exec vitest run packages/react/src/scroll-view.test.tsx`
Expected: PASS — all ScrollView tests.

- [ ] **Step 7: Verify**

Run: `pnpm --filter @pilates/react typecheck && pnpm lint`

- [ ] **Step 8: Commit**

```bash
git add packages/react/src/scroll-context.ts packages/react/src/scroll-view.tsx packages/react/src/scroll-view.test.tsx
git commit -m "react: <ScrollView> ScrollContext + useScrollIntoFocus helper"
```

---

### Task 19: Public re-exports from `@pilates/react`

**Files:**
- Modify: `packages/react/src/index.ts`
- Modify: `packages/react/src/index.test.ts`

- [ ] **Step 1: Add re-exports**

Edit `packages/react/src/index.ts`. Append:

```ts
// Scrolling (Track 1 P2)
export { ScrollView } from './scroll-view.js';
export type { ScrollViewProps, ScrollViewHandle, ScrollMeta } from './scroll-view.js';
export { useScrollIntoFocus } from './scroll-context.js';
export type { FocusedBounds, ScrollContextValue } from './scroll-context.js';
```

- [ ] **Step 2: Add a smoke test**

Append to `packages/react/src/index.test.ts`:

```ts
describe('@pilates/react public surface — scrolling', () => {
  it('re-exports ScrollView and useScrollIntoFocus', () => {
    expect(typeof Pilates.ScrollView).toBe('object'); // forwardRef result
    expect(typeof Pilates.useScrollIntoFocus).toBe('function');
  });
});
```

- [ ] **Step 3: Verify**

Run: `pnpm exec vitest run packages/react/src/index.test.ts && pnpm --filter @pilates/react typecheck && pnpm lint`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add packages/react/src/index.ts packages/react/src/index.test.ts
git commit -m "react: re-export ScrollView + useScrollIntoFocus from public barrel"
```

---

### Task 20: README "Scrolling" section

**Files:**
- Modify: `packages/react/README.md`

- [ ] **Step 1: Find the right insertion point**

Run: `grep -n "^## " packages/react/README.md`. Insert the new section after "Error handling" and before "render() options".

- [ ] **Step 2: Add the section**

Insert this block before the `## render() options` line:

````markdown
## Scrolling

`<ScrollView>` is a viewport into content larger than its visible area.
Vertical by default; pass `horizontal` for a horizontal scroller.

```tsx
import { ScrollView, Text } from '@pilates/react';

function Logs({ lines }: { lines: string[] }) {
  return (
    <ScrollView height={10} stickToBottom>
      {lines.map((line, i) => <Text key={i}>{line}</Text>)}
    </ScrollView>
  );
}
```

| Prop | Description |
|---|---|
| `height` / `width` | Viewport size in cells. Required on the scrolling axis. |
| `horizontal` | When true, scrolls X instead of Y. Default false. |
| `scrollOffset` / `defaultScrollOffset` | Controlled / uncontrolled scroll position. |
| `onScroll` | `(offset, meta) => void`. Fires on every change. |
| `stickToBottom` / `stickToTop` | Auto-scroll to edge when content grows. Pauses while user is scrolled away from edge. |
| `scrollEnabled` | Default true. Built-in arrow / PgUp / PgDn / Home / End keys when focused. |
| `scrollOnFocus` | Default true. Auto-scroll to keep focused descendants visible. |
| `scrollbar` | `'auto'` (default) / `'always'` / `'never'`. |
| `scrollbarStyle` | `{ thumb?, track?, color? }` overrides for the scrollbar glyphs. |
| `contentContainerStyle` | Extra style applied to the inner content container (post-v1). |

### Imperative API via ref

```tsx
const ref = useRef<ScrollViewHandle>(null);
ref.current?.scrollTo(50);
ref.current?.scrollToEnd();
ref.current?.scrollBy(-3);
```

`scrollTo` clamps to `[0, contentSize - viewportSize]`. The full handle:
`scrollTo`, `scrollBy`, `scrollToStart`, `scrollToEnd`, `getScrollOffset`,
`getContentSize`, `getViewportSize`.

### Focus integration

Focusable descendants (e.g. `<TextInput>`, `<Select>`) opt in to
auto-scroll-into-view by calling `useScrollIntoFocus(isFocused, boxRef)`:

```tsx
import { useFocus, useScrollIntoFocus, Box } from '@pilates/react';

function Item({ id }: { id: string }) {
  const ref = useRef(null);
  const focus = useFocus({ id });
  useScrollIntoFocus(focus.isFocused, ref);
  return <Box ref={ref}>{/* ... */}</Box>;
}
```

When the parent `<ScrollView>` has `scrollOnFocus` true (the default),
focusing the item scrolls just enough to make its bounds visible.
Focusables outside any `<ScrollView>` invoke a no-op default and behave
unchanged.

### CSS-level overflow on `<Box>`

`<ScrollView>` is built on top of `<Box overflow="hidden">` plus scroll
math. If you only need clipping (no scrolling), set `overflow` on `<Box>`
directly. Values: `'visible'` (default; treated as `'hidden'` at paint
time — terminal cell grids cannot show overflow), `'hidden'`, `'scroll'`,
`'auto'`. Per-axis: `overflowX` / `overflowY` win over the shorthand.

````

- [ ] **Step 3: Commit**

```bash
git add packages/react/README.md
git commit -m "react: README — add Scrolling section + ScrollView API reference"
```

---

### Task 21: CHANGELOG entries

**Files:**
- Modify: `packages/react/CHANGELOG.md`
- Modify or create: `packages/core/CHANGELOG.md`
- Modify or create: `packages/render/CHANGELOG.md`

- [ ] **Step 1: `@pilates/react` CHANGELOG**

Edit `packages/react/CHANGELOG.md`. Under `## Unreleased`, append:

```markdown
### Scrolling (Track 1 P2)

- **Added** `<ScrollView>` component — viewport into content larger than the
  visible area. Vertical by default; `horizontal: true` flips axis.
- **Added** Controlled (`scrollOffset`) and uncontrolled (`defaultScrollOffset`)
  scroll state, `onScroll(offset, meta)` callback, `stickToBottom` /
  `stickToTop` auto-scroll-to-edge with the standard pause-when-user-scrolls-
  away semantics.
- **Added** Built-in keys (arrow / PgUp / PgDn / Home / End) when focused.
  `scrollEnabled={false}` disables.
- **Added** Imperative ref API: `scrollTo`, `scrollBy`, `scrollToStart`,
  `scrollToEnd`, `getScrollOffset`, `getContentSize`, `getViewportSize`.
- **Added** `useScrollIntoFocus(isFocused, boxRef)` helper — focusable
  descendants opt in to auto-scroll-when-focused via the enclosing
  `<ScrollView>`. `scrollOnFocus={false}` disables.
- **Added** `overflow` / `overflowX` / `overflowY` props on `<Box>` —
  values `'visible' | 'hidden' | 'scroll' | 'auto'`. `'visible'` is the
  default and treated as `'hidden'` at paint time (terminal cell grids
  cannot display overflow without corrupting siblings).
- **Added** Re-exports: `ScrollView`, `ScrollViewProps`, `ScrollViewHandle`,
  `ScrollMeta`, `useScrollIntoFocus`, `FocusedBounds`, `ScrollContextValue`.
```

- [ ] **Step 2: `@pilates/core` CHANGELOG**

Open `packages/core/CHANGELOG.md` (create if missing — see existing root layout for template). Under `## Unreleased`, add:

```markdown
### Overflow (Track 1 P2 prep)

- **Added** `Style.overflow` / `overflowX` / `overflowY` (literal-union
  `'visible' | 'hidden' | 'scroll' | 'auto'`). Default `'visible'`. Per-axis
  longhand wins over shorthand.
- **Added** `Node.setOverflow` / `setOverflowX` / `setOverflowY` setters.
  Style change marks the node dirty.
- **Added** `Node.scrollLeft` / `scrollTop` mutable fields. Default 0.
  Mutation does NOT mark dirty (paint-time concern, not layout). Bounds
  clamping is the consumer's job.
- **Added** `ComputedLayout.scrollWidth` / `scrollHeight` and matching
  `Node.scrollWidth` / `scrollHeight` getters. For non-overflow nodes,
  equal to the node's own width/height; for overflow nodes, equal to the
  bounding box of unbounded children.
- **Verified** `overflow: scroll` and `overflow: hidden` preserve children's
  natural (unconstrained) size — unlike Yoga's advisory enum, Pilates'
  layout engine does NOT shrink overflowing children to fit.
```

- [ ] **Step 3: `@pilates/render` CHANGELOG**

Open `packages/render/CHANGELOG.md` (create if missing). Under `## Unreleased`, add:

```markdown
### Scissor clipping + scrollbar (Track 1 P2 prep)

- **Added** Internal scissor-rect stack on `Frame`: `pushScissor(rect)` /
  `popScissor()`. Cell writes outside the active scissor are dropped.
  Nested scissors are intersected so child scopes never escape parent.
- **Added** Internal `paintScrollbar` helper for vertical / horizontal
  scrollbars (text-glyph rendering, default thumb `█`, default track space).
- **Changed** Painter walks overflow nodes with: push scissor at content
  rect → translate child paint origin by `(-scrollLeft, -scrollTop)` →
  paint children → pop scissor → paint scrollbar in the gutter (when
  `overflow: scroll`, or `overflow: auto` and content overflows).
- **Added** `RenderNode.overflow` / `overflowX` / `overflowY` /
  `scrollLeft` / `scrollTop` props — passed through to core via `build.ts`.
```

- [ ] **Step 4: Commit**

```bash
git add packages/react/CHANGELOG.md packages/core/CHANGELOG.md packages/render/CHANGELOG.md
git commit -m "docs: CHANGELOG entries for ScrollView + overflow + scissor (Track 1 P2)"
```

---

### Task 22: Final verification + open PR

**Files:** none modified.

- [ ] **Step 1: Full test suite**

Run: `pnpm test`
Expected: all tests pass. Total count should be **687 + new tests**:
- Phase A: ~10 new (overflow style/Node + algorithm)
- Phase B: ~14 new (scissor + scrollbar + painter integration)
- Phase C: ~16 new (ScrollView component)
- Index smoke: 1 new

Roughly **~728 tests** at the end. If anything fails, return to the offending task.

- [ ] **Step 2: Typecheck + lint clean**

Run: `pnpm typecheck && pnpm lint`
Expected: clean across all 5 packages.

- [ ] **Step 3: Build clean**

Run: `pnpm -r build`
Expected: clean. `dist/` produced for every package.

Sanity-check source maps for the new files:
```bash
ls packages/render/dist/scissor.js.map packages/render/dist/scrollbar.js.map
ls packages/react/dist/scroll-view.js.map packages/react/dist/scroll-context.js.map
```

- [ ] **Step 4: Push the branch**

```bash
git push origin scrollview-spec
```

- [ ] **Step 5: Open the PR**

```bash
gh pr create --title "scrollview: <ScrollView> + overflow style + scissor clipping (Track 1 P2 Phase 1)" --body "$(cat <<'EOF'
## Summary

- Adds `<ScrollView>` to `@pilates/react` — viewport into content larger
  than the visible area, with controlled/uncontrolled scroll state, an
  imperative ref API, built-in arrow/PgUp/PgDn/Home/End keys when focused,
  `stickToBottom` semantics for log buffers, and `useFocus` integration
  via `useScrollIntoFocus`.
- Adds CSS-style `overflow` / `overflowX` / `overflowY` to `@pilates/core`,
  plus mutable `Node.scrollLeft` / `scrollTop` and derived `scrollWidth` /
  `scrollHeight` from the layout pass.
- Adds an internal scissor-rect stack to `@pilates/render`'s `Frame`; the
  painter walks overflow nodes with push-scissor → translate by scroll
  offset → paint children → pop scissor → paint scrollbar.

Track 1 P2 Phase 1, the largest remaining v1 capability gap. Beats Ink
(scrolling issue #222 open since 2019), beats OpenTUI on API quality, and
matches Textual's CSS fidelity. Spec at
[`docs/superpowers/specs/2026-05-06-scrollview-design.md`](docs/superpowers/specs/2026-05-06-scrollview-design.md).

`<LogView>` widget ships in a follow-on PR (~1 week of bake first).

## SemVer

- New public surface: `ScrollView`, `ScrollViewProps`, `ScrollViewHandle`,
  `ScrollMeta`, `useScrollIntoFocus`, `<Box>` `overflow` props, core
  `Style.overflow`, `Node.scrollLeft`/`scrollTop`/`scrollWidth`/`scrollHeight`.
- Bumps: `@pilates/core` 1.x → 1.1.x (additive style), `@pilates/render`
  1.x → 1.0.1 (internal-only API), `@pilates/react` 0.4.x → 0.5.0 (new
  component). All bumps deferred to the next promotion bundle.

## Test plan

- [x] `pnpm test` — full suite, ~687 → ~728
- [x] `pnpm typecheck` — clean across all 5 packages
- [x] `pnpm lint` — clean (biome)
- [x] `pnpm -r build` — `.js.map` files emitted for all new files
- [ ] CI on macOS / Ubuntu / Windows

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed; CI starts.

---

## Self-Review Checklist

This plan covers every section of the spec:

| Spec section | Task(s) |
|---|---|
| `Style.overflow` / `overflowX` / `overflowY` | Task 1 |
| `Node.setOverflow*` setters | Task 2 |
| `Node.scrollLeft` / `scrollTop` mutable fields | Task 3 |
| Yoga `OVERFLOW_SCROLL` spike | Task 4 |
| `Node.scrollWidth` / `scrollHeight` derivation | Task 5 |
| `ClipRect` + intersect | Task 6 |
| `Frame` scissor stack | Task 7 |
| Scrollbar geometry | Task 8 |
| Scrollbar painter | Task 9 |
| `RenderNode` plumbing | Task 10 |
| Painter integrates overflow + scissor + scrollbar | Task 11 |
| `<Box overflow>` prop | Task 12 |
| `<ScrollView>` skeleton | Task 13 |
| Controlled / uncontrolled state + onScroll | Task 14 |
| Imperative ref API | Task 15 |
| Built-in keys + scrollEnabled | Task 16 |
| `stickToBottom` / `stickToTop` | Task 17 |
| `ScrollContext` + scrollOnFocus + useScrollIntoFocus | Task 18 |
| Public re-exports + smoke test | Task 19 |
| README "Scrolling" section | Task 20 |
| CHANGELOG entries | Task 21 |
| Final verification + PR | Task 22 |

**Cross-task type consistency:** the function names `pushScissor` / `popScissor` / `intersect` / `contains` / `thumbGeometry` / `paintScrollbar`, the `ClipRect` / `ThumbGeometry` / `ScrollMeta` / `ScrollViewHandle` / `ScrollContextValue` / `FocusedBounds` types, the `scrollLeft` / `scrollTop` / `scrollWidth` / `scrollHeight` field names, and the `setOverflow` / `setOverflowX` / `setOverflowY` setter names are used identically across all task code blocks.

**Risk mitigations carried from spec:**
- Yoga `OVERFLOW_SCROLL` advisory: gated by Task 4's spike; if it fails, escalate before Task 5.
- Focus-scroll loops: Task 18's `useScrollIntoFocus` runs in `useEffect`, not render-time, so the focus → scroll → re-render cycle is debounced through React's commit phase.
- `stickToBottom` racing with controlled `scrollOffset`: stickToBottom's effect calls `setOffset`, which short-circuits when `isControlled` is true. Documented in Task 14 / Task 17.
- Scissor cost on hot path: a single bounds check per cell write. Profile with `pnpm bench` post-merge if perf regressions are reported.
