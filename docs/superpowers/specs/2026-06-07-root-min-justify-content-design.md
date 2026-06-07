# Root auto main-size + min-constraint `justifyContent` — Design

**Status:** approved (design phase)
**Date:** 2026-06-07
**Branch:** `fix/root-min-justify-content`
**Tracking:** closes issue #165.

## Goal

When a **root** flex container's main-axis size is `auto` and resolves upward from
`min-width`/`min-height` (or content), distribute its children with
`justifyContent` against the **resolved** main size instead of collapsing them to
flex-start at `0`. Matches Yoga 3.x. Reinstates the 2 fixtures PR #166 deferred
for this divergence.

## Root cause

For the root, `index.ts` resolves the root's own size in two stages around the
flex pipeline:

1. `resolveRootAxisSize(root, axis, available)` runs **before** `layoutChildren`.
   For `style[axis] === 'auto'` with no caller-supplied `available`, it returns
   **0** — the `min` floor is applied only in the explicit-number and
   `available !== undefined` branches, not here.
2. `layoutFlexFlow` reads `containerMain = node.layout.{width|height}` (= the
   `0` from step 1) and runs `positionItemsInLine` with `innerMain = 0`, so
   `justifyContent` has no free space and every child lands at the main-start
   edge.
3. `autoSizeRootFromContent` runs **after** positioning and clamps the root's
   size up to `clamp(content, min, max)` (e.g. 50). The size is now correct but
   the children were already positioned against `0`.

Non-root containers are immune: a parent's `buildItem` resolves the child's
min-clamped main size and writes it to `layout` **before** the child's own
`layoutFlexFlow` runs, so the child distributes against the real size. The root
has no parent to do this, and its post-step `autoSizeRootFromContent` is too late
to influence positioning.

Confirmed by repro (`minWidth: 50`, one `20×20` child, `justifyContent: center`):
root resolves to `width: 50` but `kid.left === 0` (Yoga: 15). Same on the column
main axis with `minHeight`. An explicitly-sized root (`width: 50`) already
positions correctly, proving the bug is isolated to the auto-size-from-content
root path.

## Scope

**Main axis only.** This PR fixes `justifyContent` for a bare-auto root main
size. The investigation surfaced an identical cross-axis symptom (root
`minHeight` + `alignItems: center` → `kid.top === 0` instead of 15); that lives
in a distinct, more entangled path (line cross-sizing, stretch, align-content)
and is **deferred to a follow-up issue**, not fixed here. Out of scope:
non-root auto containers (already correct), flex-grow filling of a min-resolved
root (the 2 target fixtures use fixed-size children).

## Approach

Mirror the non-root path **for the root**: position the bare-auto root's children
with `justifyContent` against the **resolved** main size,
`clamp(contentMain, minMain, maxMain)`, rather than against the unresolved `0`.

The substitution happens at the **positioning step only** (step 8,
`positionItemsInLine`) — not at line-packing or flex-distribution — which keeps
the blast radius minimal and avoids any circular dependency: by step 8 the lines
are fully packed and distributed, so the container's content main extent is known
as the max `usedMain` across lines. For a bare-auto root main axis the fix
computes, once, before the per-line positioning loop:

```
contentMain        = max over lines of usedMain(line, gapMain)   // sum of outer item mains + gaps
effectiveInnerMain = max(innerMain, clampSize(style, main, contentMain + padStart + padEnd) - padStart - padEnd)
```

where `usedMain` is the same per-line sum `positionItemsInLine` computes
internally — lifted into the caller (or a tiny shared helper) so the
`effectiveInnerMain` substitution can be computed once before the positioning
loop. The result is passed (in place of `innerMain`) to `positionItemsInLine`
for every line. For the target fixtures (fixed children, single line,
content < min) this yields `effectiveInnerMain = minMain - pads`, giving
justify-content its free space. The `max(…)` guard makes the substitution a
no-op when the root already has a concrete size (explicit style, or
caller-supplied `available` ≥ the content-clamp), and leaves flex-distribution
and cross-axis sizing completely untouched.

Because only positioning changes, flex-grow children of a min-resolved root keep
their pre-fix (distributed-against-`0`) main size — that case is explicitly out
of scope and not exercised by the target fixtures.

**Gating.** The substitution applies only when the axis is *bare-auto* — exactly
the `axisIsBareZero(root, axis, available)` predicate that `autoSizeRootFromContent`
already uses. `axisIsBareZero` needs `available` (the `calculateLayout` args),
which `layoutFlexFlow` does not receive today. `index.ts` *does* know `available`,
so it computes the per-axis bare-auto flags and threads a small descriptor into
the root's `layoutChildren` → `layoutFlexFlow` call. Recursive (non-root) calls
pass the descriptor as "not auto", leaving every existing path byte-identical.

**Consistency with the post-step.** After the fix, children are positioned
against `clamp(content, min, max)`. `autoSizeRootFromContent` then re-clamps the
root size to the same value (a no-op size write) and triggers no negative-position
shift, because the min floor keeps all main positions ≥ 0 for the target cases.

## Where the fix lives

- **Classic engine.**
  - `packages/core/src/algorithm/index.ts`: compute bare-auto flags from
    `available` and pass them into the root `layoutChildren` call.
  - `packages/core/src/algorithm/main-axis.ts`: `layoutChildren` forwards the
    flag; `layoutFlexFlow` substitutes `effectiveInnerMain` for a bare-auto root
    main axis after packing, before `positionItemsInLine`.
- **Spineless engine.**
  - `packages/core/src/algorithm/spineless/flex-grammar.ts` (+ `layout.ts` for
    the root entry/finish path): mirror the same content-clamped main size in
    the root's justify cursor emission so the differential fuzzer stays in
    lockstep. The two engines must agree bit-for-bit.

## Tests

### Unit tests (`packages/core/src/algorithm/layout.test.ts`)

```ts
describe('root auto main-size from min-constraint (#165)', () => {
  it('justify-content center distributes within min-width-resolved main size', () => {
    const root = Node.create();
    root.setFlexDirection('row');
    root.setJustifyContent('center');
    root.setMinWidth(50);
    const kid = Node.create();
    kid.setWidth(20);
    kid.setHeight(20);
    root.insertChild(kid, 0);
    root.calculateLayout();
    expect(root.getComputedLayout().width).toBe(50);
    expect(kid.getComputedLayout().left).toBe(15); // (50 - 20) / 2
  });

  it('justify-content flex-end on a min-width-resolved root', () => {
    const root = Node.create();
    root.setFlexDirection('row');
    root.setJustifyContent('flex-end');
    root.setMinWidth(50);
    const kid = Node.create();
    kid.setWidth(20);
    kid.setHeight(20);
    root.insertChild(kid, 0);
    root.calculateLayout();
    expect(kid.getComputedLayout().left).toBe(30); // 50 - 20
  });

  it('column main axis: min-height-resolved root centers on the main axis', () => {
    const root = Node.create();
    root.setFlexDirection('column');
    root.setJustifyContent('center');
    root.setMinHeight(50);
    const kid = Node.create();
    kid.setWidth(20);
    kid.setHeight(20);
    root.insertChild(kid, 0);
    root.calculateLayout();
    expect(root.getComputedLayout().height).toBe(50);
    expect(kid.getComputedLayout().top).toBe(15);
  });

  it('no min: bare-auto root still shrink-wraps (no spurious free space)', () => {
    const root = Node.create();
    root.setFlexDirection('row');
    root.setJustifyContent('center');
    const kid = Node.create();
    kid.setWidth(20);
    kid.setHeight(20);
    root.insertChild(kid, 0);
    root.calculateLayout();
    expect(root.getComputedLayout().width).toBe(20);
    expect(kid.getComputedLayout().left).toBe(0); // free space 0 → flush
  });
});
```

### Reinstated fixtures (`packages/core/test/fixtures/justify-content/`)

- `row-min-width-and-margin.spec.json` — Yoga id
  `justify_content_row_min_width_and_margin`.
- `column-min-height-and-margin.spec.json` — Yoga id
  `justify_content_column_min_height_and_margin`.

Authored via `tools/reduce-fixture.ts --tag justify-content` from the exact Yoga
gentest source (re-fetched from `facebook/yoga` `YGJustifyContentTest`), same as
the `*-max-*` pair PR #166 landed. The tool runs both yoga-layout (WASM) and the
fixed Pilates engine and emits a `ConsensusFixture` only when they agree; if it
warns, the fix did not reach that case — investigate.

### Existing suites unchanged

All 13 prior justify-content fixtures (incl. the 2 `*-max-*-and-margin`), the
overflow-justify fixtures (#167), and the full differential fuzzer must stay
green — the `max(…)` guard makes the change a no-op for every concrete-size
container.

## Risks

- **Spineless lockstep.** `flex-grammar.ts` is incremental and large; the root
  justify path must mirror the classic substitution exactly. The differential
  fuzzer (`PILATES_DIFFERENTIAL_LAYOUT=1`) is the gate — any divergence fails it.
- **Threading the flag.** Adding a parameter to `layoutChildren`/`layoutFlexFlow`
  touches a hot recursive path. Default it so non-root calls are unchanged; keep
  the substitution behind the bare-auto gate.
- **Cross-axis still broken.** Deferring the `alignItems` analog leaves a known,
  separately-tracked bug. Filed as a follow-up issue so it is not lost.

## Definition of done

- Classic engine resolves bare-auto root main size from content+min/max before
  positioning; `justifyContent` distributes correctly.
- Spineless engine mirrors it; differential fuzzer green.
- 4 unit tests pass.
- 2 deferred fixtures reinstated and passing (`row-min-width-and-margin`,
  `column-min-height-and-margin`).
- Cross-axis follow-up issue filed.
- `pnpm run ci` (lint → build → typecheck → test → test:differential) green.
- Issue #165 closed; PR opened against `main`.
