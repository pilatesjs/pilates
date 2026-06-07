# Root Margin Offset — Design

**Status:** approved (design phase)
**Date:** 2026-05-26
**Branch:** `fix/root-margin-offset`
**Tracking:** closes issue #163.

## Goal

When a root node has its own `margin` set, the root's `_layout.left` / `_layout.top` offset by `marginLeft` / `marginTop`. Pilates today leaves root at `(0, 0)` regardless of margin; Yoga 3.x offsets it by margin. Closes the 4 fixtures PR #162 deferred for this divergence.

## Behavior

- `root.layout.left = root.style.margin[Edge.Left]`
- `root.layout.top = root.style.margin[Edge.Top]`

For the ROOT specifically the relevant edges are always `Left` and `Top` (margins push the root from the implicit world origin); the root's own `flexDirection` doesn't change which margin edge is consulted.

Children's positions stay relative to the root's corner — their reported `getComputedLayout()` boxes are unchanged. Absolute children read `root.layout.width/height`, unaffected. The auto-size and post-step paths (PR #158) read child positions relative to root, also unaffected.

## Where the fix lives

### Classic engine

`packages/core/src/algorithm/index.ts`, cold-path init at lines 222-226:

```ts
root._layout.left = 0;
root._layout.top = 0;
root._floatLeft = 0;
root._floatTop = 0;
```

Replace `0` with `root.style.margin[Edge.Left]` / `[Edge.Top]` (and same value into `_floatLeft/_floatTop`).

### Spineless engine

`packages/core/src/algorithm/spineless/flex-grammar.ts`, two root-pos emission points where `compute: () => 0` is set:

- `mainPosField` for root: line ~1232 (inside `if (parent === null)`).
- `crossPosField` for root: line ~1397 (inside the matching block).

For the root, `mainPosField` is the node's `left` Field and `crossPosField` is its `top` Field (the spineless grammar's direction mapping with `parentDirection === null` falls through to the row default). So:

- `mainPosField`'s rule reads `marginInput(node, Edge.Left)` (always Left).
- `crossPosField`'s rule reads `marginInput(node, Edge.Top)` (always Top).

Adding the margin input as a dep means `setMargin` mutations propagate dirty to the root's left/top fields, triggering recompute through `writeNode` → `_layout`.

## Tests

### Unit test (`packages/core/src/algorithm/layout.test.ts`)

```ts
it('root layout offsets by its own margin', () => {
  const root = Node.create();
  root.setMargin(Edge.Left, 10);
  root.setMargin(Edge.Top, 5);
  root.setWidth(50);
  root.setHeight(40);
  const kid = Node.create();
  kid.setWidth(20);
  kid.setHeight(20);
  root.insertChild(kid, 0);
  root.calculateLayout();
  expect(root.getComputedLayout()).toMatchObject({ left: 10, top: 5, width: 50, height: 40 });
  // Child's reported left/top are relative to root's corner — unchanged.
  expect(kid.getComputedLayout()).toMatchObject({ left: 0, top: 0, width: 20, height: 20 });
});
```

### Reinstated fixtures

PR #162 deferred 4 fixtures because of this bug:
- `row-min-width-and-margin`
- `row-max-width-and-margin`
- `column-min-height-and-margin`
- `column-max-height-and-margin`

After the fix, port each via `tools/reduce-fixture.ts` (the tool will pre-fill the Yoga-matching boxes that include the margin offset).

### Differential fuzz

Both engines apply the offset via the same root-pos emission. The grammar's compute and the imperative write produce the same float values; rounding is consistent.

## Risks

- **`roundLayout` with non-zero root corner**: existing infrastructure already rounds children with arbitrary absolute parent positions (descendants compute `parentAbsX + node.layout.left`). Non-zero root corner is a strict subset of "parent at non-zero" — no new code paths.
- **`computeScrollSizes`**: walks the tree summing child extent. Reads `child.layout.left + child.layout.width` — parent-relative, unaffected.
- **`autoSizeRootFromContent`** (PR #158): reads child positions and writes root's `_layout.width/height`. Doesn't touch root's `_layout.left/top`. Compatible.
- **Spineless cache invalidation**: `marginInput` already exists and is the same input field used elsewhere; adding it as a dep on root's left/top fields uses the existing dirty-propagation pipeline.
- **`setMargin` is non-negative-only** (`node.ts` `nonNegativeOrThrow`): root's offset can't go negative.

## Out of scope

- Negative margin support (would require relaxing the validator; unrelated).
- Direction-aware margin start edges for non-root nodes (already correct via the flex pipeline).

## Definition of done

- Classic engine writes `margin.left/top` to root's `_layout` and `_floatLeft/Top`.
- Spineless grammar emits margin-driven rules for root's `mainPosField` / `crossPosField`.
- 1 unit test passes.
- 4 deferred fixtures reinstated from PR #162's deferral list.
- `pnpm test`, `pnpm test:differential`, `pnpm typecheck`, `pnpm lint`, `pnpm run ci` all green.
- Issue #163 closed by this PR.
- PR opened against `main`.
