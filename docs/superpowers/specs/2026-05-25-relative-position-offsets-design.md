# Relative-Position Offset Support — Design

**Status:** approved (design phase)
**Date:** 2026-05-25
**Owner:** Issue #150
**Branch:** `feat/relative-position-offsets`
**Tracking:** closes #150

## Goal

Make Pilates apply `position*` edges to nodes with `positionType: 'relative'`,
matching Yoga 3.x and the CSS spec. Reinstate the three deferred fixtures from
PR #149 and grow the `position-edges/` bucket.

## Behavior (matches CSS / Yoga 3.x)

For an in-flow child (`positionType: 'relative'` AND `display !== 'none'`):

- Compute the in-flow position via the existing flex pipeline (unchanged).
- After flex placement, apply offsets to the node's own `left` / `top`:
  - **x**: `left += positionLeft ?? -positionRight ?? 0`
  - **y**: `top += positionTop ?? -positionBottom ?? 0`
- Offsets do NOT change siblings' flow positions.
- Offsets do NOT change the node's `width` / `height`.
- Offsets DO move the node's descendants — they layout against the parent's
  shifted box because they read `_layout.left/top` (and `_floatLeft/Top`).

### Edge tiebreaks

If both opposing edges are set (e.g. `positionLeft=3, positionRight=5`),
**the start edge wins**: x uses `positionLeft`, y uses `positionTop`.
Rationale: relative offsets do not size the node, so opposing edges are
contradictory; CSS resolves this by preferring the start edge in LTR.

Yoga 3.x's behavior here will be verified at fixture-authoring time. If
Yoga differs, the conflict fixture is deferred (no allowlist plumbing
exists yet — issue gets filed).

## Non-goals

- No support for the `direction: rtl` flipping of left/right on relative
  offsets. Pilates is LTR-only per `style.ts:5` ("no RTL direction in v1").
- No change to absolute-child positioning (already correct per PR #149).

## Where the fix lives

### 1. Classic engine — `packages/core/src/algorithm/main-axis.ts`

In `layoutChildren`, immediately after `layoutFlexFlow(node, flowChildren)`
on line 183, iterate `flowChildren` and apply offsets via a new private
helper:

```ts
function applyRelativeOffset(child: Node): void {
  const pos = child.style.position;
  const dx = pos[POS_LEFT] !== undefined
    ? pos[POS_LEFT]
    : pos[POS_RIGHT] !== undefined
      ? -pos[POS_RIGHT]
      : 0;
  const dy = pos[POS_TOP] !== undefined
    ? pos[POS_TOP]
    : pos[POS_BOTTOM] !== undefined
      ? -pos[POS_BOTTOM]
      : 0;
  if (dx === 0 && dy === 0) return;
  child._layout.left += dx;
  child._layout.top += dy;
  child._floatLeft += dx;
  child._floatTop += dy;
}
```

Called after `layoutFlexFlow` and BEFORE the recursion into children.
`layoutAbsoluteChildren` is unaffected.

### 2. Spineless engine — `packages/core/src/algorithm/spineless/flex-grammar.ts`

**More invasive than the classic fix.** Today, `position[]` is NOT a
spineless input — it's only read for absolute children, which take a
separate non-grammar path. To support relative offsets:

- Add `position` as a new `EdgeStyleProp` in
  `packages/core/src/algorithm/spineless/style-dirty.ts` (union
  `EdgeStyleProp` becomes `'padding' | 'margin' | 'position'`).
- Extend `StyleInputs` in `flex-grammar.ts` to include `position: Field<number>[4]`
  for relative-positioned nodes.
- In the grammar emission for in-flow children, add a post-flex offset
  step: `outX = flexLeft + (positionLeft ?? -positionRight ?? 0)`, same
  for y. The exact emission point is the position-write rule in
  `flex-grammar.ts` (around line 970–1010 for the wrap and no-wrap paths;
  to be located precisely during implementation).
- The fold-default-inputs optimization (phase 17) means a node with no
  position edges set should emit no extra Fields — defaults fold to 0.

### 3. Cache invalidation

- Classic: `setPosition` already calls `markDirtyFlag(DIRTY_STYLE_VALUE)`
  (`node.ts:425`). The layout cache stores post-shifted positions in
  `_layout.left/top` and `_floatLeft/Top`. A dirty node bypasses the cache
  fast-path (`layoutChildren:145`) and recomputes — no extra plumbing.
- Spineless: the new `position` input Fields are part of the grammar's
  StyleInputs; marking them dirty via `markStyleDirty(node, 'position', edge)`
  triggers recompute. The `markStyleDirty` API and the consumer plumbing
  in `Node.setPosition` need a new dispatch entry.

### 4. Mutation API surface — no changes

`Node.setPosition` already exists and is the public surface. The fix is
purely internal to the layout pipeline. Existing call sites (including the
absolute-position fixture corpus) are unaffected.

## Implementation order

The two engines must agree per the differential test suite
(`PILATES_DIFFERENTIAL_LAYOUT=1`). Two-commit plan to make divergence easy
to catch:

1. **Commit A — classic + tests.** Fix `main-axis.ts`, reinstate the 3
   deferred fixtures, add the 4 new fixtures, run `pnpm test` (NOT
   differential yet). The differential suite is expected to FAIL at this
   point — classic now applies offsets, spineless doesn't.
2. **Commit B — spineless + cache.** Wire `position` into
   `style-dirty.ts`, `flex-grammar.ts`, and `Node.setPosition`'s
   dispatcher. Re-run `pnpm test:differential` — expect PASS. Run
   fuzz tests (`packages/core/test/properties.test.ts` and the spineless
   structural fuzzer) — expect PASS.

If the fuzzers find a divergence the fixture corpus didn't, treat as a
real bug; do not weaken assertions to make them pass.

## Tests

### Reinstated (from `DEFERRED-FIXTURES.md`)

- `position-edges/relative-offset-top-left.spec.json`
- `position-edges/relative-offset-bottom.spec.json`
- `position-edges/multiple-relative-children.spec.json`

### New fixtures (4)

- `position-edges/relative-offset-right.spec.json` —
  child width=10, height=5 with `positionRight=3`. Equivalent to `left: -3`.
  Expected: kid at left=-3, top=0.
- `position-edges/relative-offset-top-and-left.spec.json` —
  child positioned both axes simultaneously.
- `position-edges/nested-relative-inside-relative.spec.json` —
  Parent relative with `positionLeft=2`, child relative with `positionLeft=3`.
  Total displacement = additive at render: parent shifts by 2, child shifts
  by 3 RELATIVE TO PARENT'S SHIFTED BOX. `_layout` stores parent-relative
  coords so the child's `left` is just 3 (the parent's 2 doesn't appear in
  the child's own box). The parent's `left` is its flow position + 2.
- `position-edges/absolute-inside-relative-with-offset.spec.json` —
  Pinned invariant: an absolute child inside a relative parent that has a
  position offset should anchor to the parent's shifted box. Confirms
  the abs-positioning path reads the shifted parent layout.

### Unit test for sibling-flow invariant

In `packages/core/src/algorithm/layout.test.ts` (or its closest neighbour):

```ts
it('relative position offsets do not displace siblings', () => {
  const root = Node.create();
  root.setFlexDirection('row');
  root.setWidth(40);
  root.setHeight(10);
  const a = Node.create();
  a.setWidth(10);
  a.setHeight(5);
  a.setPosition(Edge.Left, 5);    // shift a right by 5
  const b = Node.create();
  b.setWidth(10);
  b.setHeight(5);
  root.insertChild(a, 0);
  root.insertChild(b, 1);
  root.calculateLayout();
  expect(a.getComputedLayout()).toMatchObject({ left: 5, top: 0 });
  expect(b.getComputedLayout()).toMatchObject({ left: 10, top: 0 }); // unaffected
});
```

### Cleanup

- Remove the `position-edges` section from `DEFERRED-FIXTURES.md`. If that
  leaves the file empty, delete it.
- Reference issue #150 in the PR description as closed.

## Risks

- **Spineless grammar regression.** Adding any new field to `StyleInputs`
  has historically cost a rebuild path; the fold-default optimization
  (`feedback_pilates_perf_hypothesis_verify_first` warns about premature
  perf reasoning). Verify with `pnpm bench` AFTER both commits.
- **Tiebreak verification.** The "left wins over right" rule is a guess
  about CSS; the conflict fixture (covered above implicitly by Yoga
  agreement) will tell us.
- **Nested relative.** The compound-offset case (nested relative) is the
  most likely place a subtle off-by-one slips in. The fixture above is
  the regression pin.

## Definition of done

- 3 deferred fixtures reinstated + 4 new fixtures added; all 7 pass against
  both engines.
- 1 sibling-invariant unit test passes.
- `pnpm test`, `pnpm test:differential`, `pnpm typecheck`, `pnpm lint`,
  `pnpm run ci` all green.
- `pnpm bench` shows no regression beyond per-PR noise budget.
- `DEFERRED-FIXTURES.md` cleaned up (section removed; file deleted if empty).
- PR opened, references issue #150 as closing.
