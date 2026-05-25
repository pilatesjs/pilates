# Relative-Position Offset Support — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Pilates apply `position*` edges on `positionType: 'relative'` nodes, matching Yoga 3.x / CSS spec; reinstate 3 deferred fixtures + add 4 new ones; close issue #150.

**Architecture:** Two-engine fix:
1. **Classic engine** (`main-axis.ts`): post-flex helper `applyRelativeOffset(child)` mutates `_layout.left/top` and `_floatLeft/Top` after `layoutFlexFlow`.
2. **Spineless engine** (`flex-grammar.ts`): new per-edge `positionInput(node, edge)` leaf Fields + a post-emission wrapper that adds the offsets to `mainPosField` / `crossPosField` (analogous to `applyReverseMainPos`).

**Tech Stack:** TypeScript, vitest, Pilates dual-engine layout.

**Spec:** `docs/superpowers/specs/2026-05-25-relative-position-offsets-design.md`
**Branch:** `feat/relative-position-offsets` (already checked out from commit `85075f1`).
**Closes:** issue #150.

---

## File Structure

| Path | Change | Responsibility |
|---|---|---|
| `packages/core/src/algorithm/main-axis.ts` | modify | Add `applyRelativeOffset` private helper + call after `layoutFlexFlow` |
| `packages/core/src/algorithm/spineless/style-dirty.ts` | modify | Add `'position'` to `EdgeStyleProp`; dispatch it |
| `packages/core/src/algorithm/spineless/flex-grammar.ts` | modify | Add `positionInput(node, edge)` + `StyleInputs.position` + post-emission `applyRelativePositionOffset` wrapper |
| `packages/core/src/node.ts` | modify | In `setPosition`, also call the spineless dirtier (via the existing protocol — verify by reading how `setPadding` notifies) |
| `packages/core/src/algorithm/layout.test.ts` | modify | One sibling-invariant test |
| `packages/core/test/fixtures/position-edges/*.spec.json` | create | 3 reinstated + 4 new fixtures |
| `DEFERRED-FIXTURES.md` | delete | Empty after reinstating the 3 deferred entries |

---

## Task 1: Classic engine — `applyRelativeOffset` helper

**Files:**
- Modify: `packages/core/src/algorithm/main-axis.ts`

The helper is added near the existing `layoutAbsoluteChild` (~line 374); the call site is in `layoutChildren` right after `layoutFlexFlow`.

- [ ] **Step 1: Read current state of `layoutChildren` and `layoutAbsoluteChild` to locate insertion points.**

Run:
```bash
grep -n "layoutFlexFlow\|layoutAbsoluteChild\|layoutAbsoluteChildren" packages/core/src/algorithm/main-axis.ts | head -10
```
Expected lines (from current `85075f1` HEAD): `layoutFlexFlow` defined at 269, called from `layoutChildren` at 183. `layoutAbsoluteChildren` defined at 361, called at 187. `layoutAbsoluteChild` at 374.

- [ ] **Step 2: Add the helper after `layoutAbsoluteChild` (after line 448).**

Insert this block IMMEDIATELY before the next function declaration:

```ts
/**
 * Apply CSS relative-position offsets to an in-flow child's final box.
 *
 * Called once per flow child after `layoutFlexFlow` finalized the box's
 * `left/top`. The offset is added to both the rounded and float positions;
 * width / height are untouched.
 *
 * Edge tiebreak (matches CSS): if both opposing edges are set, the start
 * edge wins — `positionLeft` over `positionRight`, `positionTop` over
 * `positionBottom`. Yoga 3.x has the same tiebreak.
 *
 * No-op for absolute children (they are positioned by `layoutAbsoluteChild`
 * against the parent's outer box and never reach this helper).
 */
function applyRelativeOffset(child: Node): void {
  const pos = child.style.position;
  const dx =
    pos[POS_LEFT] !== undefined
      ? pos[POS_LEFT]
      : pos[POS_RIGHT] !== undefined
        ? -pos[POS_RIGHT]
        : 0;
  const dy =
    pos[POS_TOP] !== undefined
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

- [ ] **Step 3: Wire the helper into `layoutChildren`.**

Find the existing block in `packages/core/src/algorithm/main-axis.ts` around line 182:

```ts
  if (flowChildren.length > 0) {
    layoutFlexFlow(node, flowChildren);
  }
```

Replace with:

```ts
  if (flowChildren.length > 0) {
    layoutFlexFlow(node, flowChildren);
    for (const c of flowChildren) applyRelativeOffset(c);
  }
```

- [ ] **Step 4: Typecheck.**

Run: `pnpm typecheck`
Expected: PASS across all 6 packages.

- [ ] **Step 5: Commit (no tests yet — Task 2 adds them).**

```bash
git add packages/core/src/algorithm/main-axis.ts
git commit -m "feat(core): classic engine applies relative-position offsets (#150)"
```

---

## Task 2: Unit test — sibling-flow invariant

**Files:**
- Modify: `packages/core/src/algorithm/layout.test.ts`

This pins the most important invariant: a relative offset must not displace siblings.

- [ ] **Step 1: Locate the existing positionType-related tests.**

Run:
```bash
grep -n "positionType\|setPosition\|describe(" packages/core/src/algorithm/layout.test.ts | head -20
```

Pick an appropriate location near other positionType tests (or at end of an existing `describe('positioning', ...)`/equivalent). If no such describe exists, append a new top-level `describe('relative-position offsets', ...)`.

- [ ] **Step 2: Add the test.**

Append:

```ts
describe('relative-position offsets', () => {
  it('do not displace siblings', () => {
    const root = Node.create();
    root.setFlexDirection('row');
    root.setWidth(40);
    root.setHeight(10);

    const a = Node.create();
    a.setWidth(10);
    a.setHeight(5);
    a.setPosition(Edge.Left, 5);

    const b = Node.create();
    b.setWidth(10);
    b.setHeight(5);

    root.insertChild(a, 0);
    root.insertChild(b, 1);
    root.calculateLayout();

    expect(a.getComputedLayout()).toMatchObject({ left: 5, top: 0, width: 10, height: 5 });
    expect(b.getComputedLayout()).toMatchObject({ left: 10, top: 0, width: 10, height: 5 });
  });

  it('positionTop wins over positionBottom when both set', () => {
    const root = Node.create();
    root.setFlexDirection('column');
    root.setWidth(10);
    root.setHeight(20);

    const a = Node.create();
    a.setWidth(10);
    a.setHeight(5);
    a.setPosition(Edge.Top, 3);
    a.setPosition(Edge.Bottom, 2);

    root.insertChild(a, 0);
    root.calculateLayout();

    expect(a.getComputedLayout()).toMatchObject({ top: 3 });
  });
});
```

Imports to verify: `Node` and `Edge` should already be imported by the file. If not, add to existing import block:

```ts
import { Node } from '../node.js';
import { Edge } from '../edge.js';
```

(Check existing imports first — duplicating breaks the build.)

- [ ] **Step 3: Run the tests — both should PASS** (classic engine fix from Task 1 is sufficient).

Run: `pnpm test packages/core/src/algorithm/layout.test.ts`
Expected: 2 new tests in `relative-position offsets` pass + all existing tests in the file still pass.

- [ ] **Step 4: Commit.**

```bash
git add packages/core/src/algorithm/layout.test.ts
git commit -m "test(core): pin sibling-invariant for relative-position offsets"
```

---

## Task 3: Reinstate 3 deferred fixtures

**Files:**
- Create: `packages/core/test/fixtures/position-edges/relative-offset-top-left.spec.json`
- Create: `packages/core/test/fixtures/position-edges/relative-offset-bottom.spec.json`
- Create: `packages/core/test/fixtures/position-edges/multiple-relative-children.spec.json`

Content lifted from `DEFERRED-FIXTURES.md` (the Yoga-expected boxes are the spec).

- [ ] **Step 1: Write `relative-offset-top-left.spec.json`:**

```json
{
  "name": "position-edges/relative-offset-top-left",
  "tags": ["position-edges"],
  "root": {
    "id": "root",
    "style": { "flexDirection": "row", "width": 40, "height": 10 },
    "children": [
      {
        "id": "kid",
        "style": { "width": 10, "height": 5, "positionTop": 2, "positionLeft": 3 }
      }
    ]
  },
  "expected": {
    "root": { "left": 0, "top": 0, "width": 40, "height": 10 },
    "kid": { "left": 3, "top": 2, "width": 10, "height": 5 }
  }
}
```

- [ ] **Step 2: Write `relative-offset-bottom.spec.json`:**

```json
{
  "name": "position-edges/relative-offset-bottom",
  "tags": ["position-edges"],
  "root": {
    "id": "root",
    "style": { "flexDirection": "row", "width": 40, "height": 10 },
    "children": [
      {
        "id": "kid",
        "style": { "width": 10, "height": 5, "positionBottom": 2 }
      }
    ]
  },
  "expected": {
    "root": { "left": 0, "top": 0, "width": 40, "height": 10 },
    "kid": { "left": 0, "top": -2, "width": 10, "height": 5 }
  }
}
```

- [ ] **Step 3: Write `multiple-relative-children.spec.json`:**

```json
{
  "name": "position-edges/multiple-relative-children",
  "tags": ["position-edges"],
  "root": {
    "id": "root",
    "style": { "flexDirection": "row", "width": 40, "height": 10 },
    "children": [
      { "id": "a", "style": { "width": 10, "height": 5 } },
      { "id": "b", "style": { "width": 10, "height": 5, "positionLeft": 5 } }
    ]
  },
  "expected": {
    "root": { "left": 0, "top": 0, "width": 40, "height": 10 },
    "a": { "left": 0, "top": 0, "width": 10, "height": 5 },
    "b": { "left": 15, "top": 0, "width": 10, "height": 5 }
  }
}
```

- [ ] **Step 4: Run the fixtures suite. Classic-only test (NOT differential).**

Run: `pnpm test packages/core/test/fixtures.test.ts`
Expected: 64 passing (was 61 + 3 reinstated). The runner builds both Pilates and Yoga; both must match the expected boxes. With classic engine fix applied, Pilates matches Yoga for these three.

- [ ] **Step 5: Run `pnpm format` to apply biome's JSON formatting.**

Run: `pnpm format`
Expected: 3 files re-formatted (the new JSONs). If any other files change, investigate.

- [ ] **Step 6: Commit.**

```bash
git add packages/core/test/fixtures/position-edges/
git commit -m "test(core): reinstate 3 deferred position-edges fixtures (#150)"
```

---

## Task 4: Add 4 new position-edges fixtures

**Files:**
- Create: `packages/core/test/fixtures/position-edges/relative-offset-right.spec.json`
- Create: `packages/core/test/fixtures/position-edges/relative-offset-top-and-left.spec.json`
- Create: `packages/core/test/fixtures/position-edges/nested-relative-inside-relative.spec.json`
- Create: `packages/core/test/fixtures/position-edges/absolute-inside-relative-with-offset.spec.json`

- [ ] **Step 1: Write `relative-offset-right.spec.json`:**

```json
{
  "name": "position-edges/relative-offset-right",
  "tags": ["position-edges"],
  "root": {
    "id": "root",
    "style": { "flexDirection": "row", "width": 40, "height": 10 },
    "children": [
      {
        "id": "kid",
        "style": { "width": 10, "height": 5, "positionRight": 3 }
      }
    ]
  },
  "expected": {
    "root": { "left": 0, "top": 0, "width": 40, "height": 10 },
    "kid": { "left": -3, "top": 0, "width": 10, "height": 5 }
  }
}
```

- [ ] **Step 2: Write `relative-offset-top-and-left.spec.json`:**

```json
{
  "name": "position-edges/relative-offset-top-and-left",
  "tags": ["position-edges"],
  "root": {
    "id": "root",
    "style": { "flexDirection": "row", "width": 40, "height": 20 },
    "children": [
      {
        "id": "kid",
        "style": { "width": 10, "height": 5, "positionTop": 4, "positionLeft": 6 }
      }
    ]
  },
  "expected": {
    "root": { "left": 0, "top": 0, "width": 40, "height": 20 },
    "kid": { "left": 6, "top": 4, "width": 10, "height": 5 }
  }
}
```

- [ ] **Step 3: Write `nested-relative-inside-relative.spec.json`:**

The child's `_layout.left/top` is relative to its parent. The parent's offset doesn't appear in the child's own box.

```json
{
  "name": "position-edges/nested-relative-inside-relative",
  "tags": ["position-edges"],
  "root": {
    "id": "root",
    "style": { "flexDirection": "row", "width": 40, "height": 20 },
    "children": [
      {
        "id": "parent",
        "style": { "flexDirection": "row", "width": 20, "height": 10, "positionLeft": 2 },
        "children": [
          { "id": "kid", "style": { "width": 5, "height": 5, "positionLeft": 3 } }
        ]
      }
    ]
  },
  "expected": {
    "root": { "left": 0, "top": 0, "width": 40, "height": 20 },
    "parent": { "left": 2, "top": 0, "width": 20, "height": 10 },
    "kid": { "left": 3, "top": 0, "width": 5, "height": 5 }
  }
}
```

- [ ] **Step 4: Write `absolute-inside-relative-with-offset.spec.json`:**

An absolute child inside a relative parent that has a position offset: the absolute child anchors against its parent's box (which has been shifted by the parent's offset, but `_layout` stores parent-relative coords, so the abs child's reported left/top are unchanged from the no-parent-offset case).

```json
{
  "name": "position-edges/absolute-inside-relative-with-offset",
  "tags": ["position-edges", "absolute-position"],
  "root": {
    "id": "root",
    "style": { "flexDirection": "row", "width": 40, "height": 20 },
    "children": [
      {
        "id": "parent",
        "style": { "flexDirection": "row", "width": 20, "height": 10, "positionLeft": 5 },
        "children": [
          {
            "id": "abs",
            "style": {
              "positionType": "absolute",
              "positionTop": 1,
              "positionLeft": 2,
              "width": 4,
              "height": 3
            }
          }
        ]
      }
    ]
  },
  "expected": {
    "root": { "left": 0, "top": 0, "width": 40, "height": 20 },
    "parent": { "left": 5, "top": 0, "width": 20, "height": 10 },
    "abs": { "left": 2, "top": 1, "width": 4, "height": 3 }
  }
}
```

- [ ] **Step 5: Run the suite. Differential mode disabled — classic-only must pass.**

Run: `pnpm test packages/core/test/fixtures.test.ts`
Expected: 68 passing. If a fixture fails: triage. Engines-agree-but-differ-from-expected → fix expected. Engines-disagree → defer per the standard discipline.

- [ ] **Step 6: Format + commit.**

```bash
pnpm format
git add packages/core/test/fixtures/position-edges/
git commit -m "test(core): add 4 position-edges fixtures for relative offsets (#150)"
```

---

## Task 5: Confirm differential suite FAILS as expected

**Files:** none (verification only)

The spineless engine has not yet been updated. Running differential mode should now show a mismatch on the 7 relative-position fixtures.

- [ ] **Step 1: Run the differential suite.**

Run: `pnpm test:differential 2>&1 | tail -40`
Expected: SOME failures, specifically on the 7 new/reinstated `position-edges/` fixtures (or on related properties.test.ts fast-check assertions). Other tests still PASS.

- [ ] **Step 2: Record the failure count.**

In a scratch note (do not commit): write down the number of failed fixtures and the names. This is the gap Task 6 closes.

- [ ] **Step 3: If MORE failures appear than expected** (e.g., previously-passing fixtures now fail in differential mode): STOP. Something in Task 1 broke the classic engine on a path the unit tests don't cover. Investigate before continuing.

- [ ] **Step 4: No commit — this step is a checkpoint.**

---

## Task 6: Spineless — `positionInput` leaf Field

**Files:**
- Modify: `packages/core/src/algorithm/spineless/flex-grammar.ts`

Add a leaf input Field for each per-edge position value, mirroring `marginInput` exactly. The Field reads `node.style.position[edge] ?? 0` live.

- [ ] **Step 1: Extend `StyleInputs` interface near line 103.**

Find the existing block in `flex-grammar.ts`:

```ts
  /**
   * Per-edge `margin` input Fields, indexed `[top, right, bottom,
   * left]`. Present for every non-root in-flow node and every
   * absolute child (the grammar reads all four edges).
   */
  margin?: Array<Field<number> | undefined>;
}
```

Replace with:

```ts
  /**
   * Per-edge `margin` input Fields, indexed `[top, right, bottom,
   * left]`. Present for every non-root in-flow node and every
   * absolute child (the grammar reads all four edges).
   */
  margin?: Array<Field<number> | undefined>;
  /**
   * Per-edge `position` input Fields, indexed `[top, right, bottom,
   * left]`. Present only for in-flow nodes with `positionType:
   * relative` that have at least one position edge set; absolute
   * children read `node.style.position` directly via the
   * non-grammar path. Entries fold to 0 when an edge is unset.
   */
  position?: Array<Field<number> | undefined>;
}
```

- [ ] **Step 2: Add `positionInput` helper near `marginInput` (after line 558).**

Insert immediately after the closing brace of `marginInput`:

```ts
  // Register (once) the leaf input Field for one `position` edge of a
  // node (`edge` is a [top, right, bottom, left] index). Defaults to 0
  // when that edge is unset. Used only for in-flow relative nodes; the
  // absolute-positioning path reads `node.style.position` directly.
  function positionInput(n: Node, edge: number): Field<number> {
    const f = field<number>(n, `style:position:${edge}`);
    if (boundary?.has(f as Field<unknown>)) return f;
    if (!grammar.has(f as Field<unknown>)) {
      grammar.set(f as Field<unknown>, {
        deps: [],
        compute: () => n.style.position[edge] ?? 0,
      } satisfies FieldRule<number>);
      const entry = styleInputEntry(n);
      if (entry.position === undefined) entry.position = [];
      entry.position[edge] = f;
    }
    return f;
  }
```

- [ ] **Step 3: Typecheck.**

Run: `pnpm typecheck`
Expected: PASS. The helper is defined but unused — TS allows unused functions inside a containing function scope.

- [ ] **Step 4: Commit.**

```bash
git add packages/core/src/algorithm/spineless/flex-grammar.ts
git commit -m "feat(core): spineless adds positionInput leaf field (#150)"
```

---

## Task 7: Spineless — `applyRelativePositionOffset` post-emission wrapper

**Files:**
- Modify: `packages/core/src/algorithm/spineless/flex-grammar.ts`

Wraps the already-emitted `mainPosField` and `crossPosField` rules with an offset adder. The pattern mirrors `applyReverseMainPos` (line 2404).

- [ ] **Step 1: Add the helper near `applyReverseMainPos` (after line 2435).**

Insert:

```ts
/**
 * Apply CSS relative-position offsets to an in-flow child's
 * `mainPosField` / `crossPosField` by wrapping their already-emitted
 * rules with an additive transform.
 *
 * Tiebreak (matches CSS / Yoga 3.x): when both opposing edges are set,
 * the start edge wins — `positionTop` over `positionBottom`,
 * `positionLeft` over `positionRight`. Mirrors `applyRelativeOffset`
 * in the classic engine.
 *
 * No-op when the node has no position edges set on the relevant axis
 * (every relevant edge folds to 0 via `positionInput` defaults; the
 * spineless fold-default-inputs optimization will eliminate constant-0
 * wrappers at grammar build time when both edges are absent — but for
 * simplicity this wrapper is always emitted for relative nodes and the
 * runtime evaluates a `+0` cheaply).
 *
 * @internal
 */
function applyRelativePositionOffset(
  grammar: Grammar,
  mainPosField: Field<unknown>,
  crossPosField: Field<unknown>,
  positionMainStartF: Field<number>,
  positionMainEndF: Field<number>,
  positionCrossStartF: Field<number>,
  positionCrossEndF: Field<number>,
): void {
  for (const [posField, startF, endF] of [
    [mainPosField, positionMainStartF, positionMainEndF],
    [crossPosField, positionCrossStartF, positionCrossEndF],
  ] as const) {
    const forward = grammar.get(posField) as FieldRule<number>;
    const deps = [...forward.deps];
    for (const d of [startF as Field<unknown>, endF as Field<unknown>]) {
      if (!deps.includes(d)) deps.push(d);
    }
    grammar.set(posField, {
      deps,
      compute: (read) => {
        const base = forward.compute(read);
        const start = read(startF);
        const end = read(endF);
        // Start edge wins over end edge per CSS tiebreak. The startF/endF
        // Fields read `style.position[edge] ?? 0`, so we cannot distinguish
        // "edge set to 0" from "edge unset" — but a 0-value start edge
        // adds 0 anyway, so the tiebreak collapses to: prefer start when
        // its source value is non-zero; otherwise use -end.
        // To preserve "start wins even when zero" semantics, read the live
        // style array to disambiguate. This matches the classic engine.
        return base + start - end + 0; // see live-style fallback below
      },
    } satisfies FieldRule<number>);
  }
}
```

**WAIT** — the inline tiebreak comment exposes a real subtlety. `positionInput` folds undefined to 0, so `start=0` could mean "no offset" or "set to 0". The grammar can't see that distinction without reading live style. But the resulting math is the same — when start is 0 (whether unset or explicit 0), `base + 0 - end` is just `base - end`. If end is also unset (also 0), result = base. If end is set to N, result = base - N. That's the correct "right-edge wins when left is unset" behavior.

But the spec requires "left wins over right if BOTH are set, including left=0". This requires distinguishing unset-vs-zero. Read the live style array in the wrapper:

Replace the body of the loop with the actual correct version:

```ts
  for (const [posField, startF, endF, startEdge, endEdge] of [
    [mainPosField, positionMainStartF, positionMainEndF, mainStartEdgeIdx, mainEndEdgeIdx],
    [crossPosField, positionCrossStartF, positionCrossEndF, crossStartEdgeIdx, crossEndEdgeIdx],
  ] as const) {
    const forward = grammar.get(posField) as FieldRule<number>;
    const deps = [...forward.deps];
    for (const d of [startF as Field<unknown>, endF as Field<unknown>]) {
      if (!deps.includes(d)) deps.push(d);
    }
    grammar.set(posField, {
      deps,
      compute: (read) => {
        const base = forward.compute(read);
        const startSet = node.style.position[startEdge] !== undefined;
        if (startSet) return base + read(startF);
        const endSet = node.style.position[endEdge] !== undefined;
        if (endSet) return base - read(endF);
        return base;
      },
    } satisfies FieldRule<number>);
  }
```

The `node`, `mainStartEdgeIdx`, etc., must be passed in. Adjust the function signature to take them. The full corrected helper is given in Step 2 below — the draft above is illustrative.

- [ ] **Step 2: Use this final signature and body for `applyRelativePositionOffset` (replacing the draft from Step 1):**

```ts
function applyRelativePositionOffset(
  grammar: Grammar,
  node: Node,
  mainPosField: Field<unknown>,
  crossPosField: Field<unknown>,
  positionMainStartF: Field<number>,
  positionMainEndF: Field<number>,
  positionCrossStartF: Field<number>,
  positionCrossEndF: Field<number>,
  mainStartEdgeIdx: number,
  mainEndEdgeIdx: number,
  crossStartEdgeIdx: number,
  crossEndEdgeIdx: number,
): void {
  const pairs = [
    [mainPosField, positionMainStartF, positionMainEndF, mainStartEdgeIdx, mainEndEdgeIdx],
    [crossPosField, positionCrossStartF, positionCrossEndF, crossStartEdgeIdx, crossEndEdgeIdx],
  ] as const;
  for (const [posField, startF, endF, startEdge, endEdge] of pairs) {
    const forward = grammar.get(posField) as FieldRule<number>;
    const deps = [...forward.deps];
    for (const d of [startF as Field<unknown>, endF as Field<unknown>]) {
      if (!deps.includes(d)) deps.push(d);
    }
    grammar.set(posField, {
      deps,
      compute: (read) => {
        const base = forward.compute(read);
        if (node.style.position[startEdge] !== undefined) return base + read(startF);
        if (node.style.position[endEdge] !== undefined) return base - read(endF);
        return base;
      },
    } satisfies FieldRule<number>);
  }
}
```

- [ ] **Step 3: Typecheck (helper is defined but not yet called).**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Commit.**

```bash
git add packages/core/src/algorithm/spineless/flex-grammar.ts
git commit -m "feat(core): spineless adds applyRelativePositionOffset wrapper (#150)"
```

---

## Task 8: Spineless — call the wrapper from the in-flow path

**Files:**
- Modify: `packages/core/src/algorithm/spineless/flex-grammar.ts`

The wrapper must be invoked once per in-flow child AFTER the rest of the rule emission has finalized `mainPosField` / `crossPosField` (including any `applyReverseMainPos` wrap). Looking at line 689 onward, `mainPosField` / `crossPosField` are derived right before the rule-emission cascade. The wrap should happen at the END of the in-flow branch of `visit`, right before recursion into children.

- [ ] **Step 1: Find the end of the in-flow `visit` branch.**

Run:
```bash
grep -n "allFields.push\|visit(child," packages/core/src/algorithm/spineless/flex-grammar.ts | head -20
```

The end-of-visit recursion into children is structured like the absolute branch (line 654–668). The in-flow branch closes around `visit(child, ...)` for each in-flow child. Find the exact line (it follows the position-rule emissions; should be near line 1400 based on earlier grep showing `visit(child, node, ...)` patterns).

- [ ] **Step 2: Insert the offset application call immediately BEFORE the in-flow recursion that ends `visit`.**

The call needs the four position input Fields + the four edge indices. Edge index helpers exist (`mainStartEdge`, `mainEndEdge`, `crossStartEdge`, `crossEndEdge` — confirm by grep). The call:

```ts
    if (parent !== null && isInFlow(node)) {
      const hasAnyPositionEdge =
        node.style.position[0] !== undefined ||
        node.style.position[1] !== undefined ||
        node.style.position[2] !== undefined ||
        node.style.position[3] !== undefined;
      if (hasAnyPositionEdge && parentDirection !== null) {
        const mainStartIdx = mainStartEdge(parentDirection);
        const mainEndIdx = mainEndEdge(parentDirection);
        const crossStartIdx = crossStartEdge(parentDirection);
        const crossEndIdx = crossEndEdge(parentDirection);
        applyRelativePositionOffset(
          grammar,
          node,
          mainPosField,
          crossPosField,
          positionInput(node, mainStartIdx),
          positionInput(node, mainEndIdx),
          positionInput(node, crossStartIdx),
          positionInput(node, crossEndIdx),
          mainStartIdx,
          mainEndIdx,
          crossStartIdx,
          crossEndIdx,
        );
      }
    }
```

This block is inserted immediately BEFORE the line that recurses into children at the end of the in-flow branch of `visit`. The `isInFlow` predicate already exists in the file (grep `function isInFlow` to confirm location; if it doesn't exist, replace with `node.style.positionType !== 'absolute' && node.style.display !== 'none'`).

The `hasAnyPositionEdge` short-circuit avoids needless Field creation for the common case of a relative node with no offsets set.

- [ ] **Step 3: Typecheck.**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Run the differential suite.**

Run: `pnpm test:differential 2>&1 | tail -20`
Expected: The 7 fixture-suite failures from Task 5 are gone. Total passing matches Task 5's pre-failure baseline + 7 reinstated fixtures + sibling-invariant unit test.

- [ ] **Step 5: If failures remain:**

Most likely causes:
1. **The insertion point is wrong** — wrapper runs before some other emission that subsequently overwrites `mainPosField`/`crossPosField`. Walk backward through `grammar.set(mainPosField, ...)` calls to find the last one and put the wrapper after it.
2. **`applyReverseMainPos` runs after this** — for `row-reverse` parents. The wrapper must run AFTER `applyReverseMainPos`, since the spec semantics say offsets apply to the final flow position regardless of reverse. If reordering is needed, do it.
3. **Cache invalidation gap** — the `setPosition` dirtier isn't propagating. See Task 9.

Diagnose, fix, re-run. Do NOT weaken the spec.

- [ ] **Step 6: Commit when green.**

```bash
git add packages/core/src/algorithm/spineless/flex-grammar.ts
git commit -m "feat(core): spineless wires relative-position offsets into in-flow path (#150)"
```

---

## Task 9: Wire `setPosition` to the spineless dirtier

**Files:**
- Modify: `packages/core/src/algorithm/spineless/style-dirty.ts`

Add `'position'` to `EdgeStyleProp` and the dispatcher. Find any consumer that currently has a `setPosition` -> dirtier hook and extend it.

- [ ] **Step 1: Read current `EdgeStyleProp` and dispatcher.**

Run: `grep -n "EdgeStyleProp\|position\|prop === " packages/core/src/algorithm/spineless/style-dirty.ts`

- [ ] **Step 2: Extend the `EdgeStyleProp` union.**

In `packages/core/src/algorithm/spineless/style-dirty.ts`, change:

```ts
export type EdgeStyleProp = 'padding' | 'margin';
```

to:

```ts
export type EdgeStyleProp = 'padding' | 'margin' | 'position';
```

- [ ] **Step 3: Extend the dispatch in `createStyleDirtier`.**

Find:

```ts
    if (prop === 'padding' || prop === 'margin') {
      if (edge === undefined) {
        throw new Error(`[spineless] markStyleDirty: '${prop}' requires an edge index`);
      }
      f = entry?.[prop]?.[edge];
    } else {
```

Replace with:

```ts
    if (prop === 'padding' || prop === 'margin' || prop === 'position') {
      if (edge === undefined) {
        throw new Error(`[spineless] markStyleDirty: '${prop}' requires an edge index`);
      }
      f = entry?.[prop]?.[edge];
    } else {
```

- [ ] **Step 4: Find consumers that dispatch on style mutations.**

Run: `grep -rn "markStyleDirty\|StyleDirtier" packages/core/src/ packages/render/src/ packages/react/src/ packages/widgets/src/ | head -20`

The harness that drives `setPosition -> markStyleDirty(node, 'position', edge)` calls lives outside this file (likely in a render-adapter or test harness). Identify the call sites. If any of them switches on the prop name and lacks a `'position'` case, add one.

- [ ] **Step 5: Typecheck.**

Run: `pnpm typecheck`
Expected: PASS. Any consumer that switch-exhausts on `EdgeStyleProp` will surface as a TS error here — fix in-place.

- [ ] **Step 6: Run differential suite again.**

Run: `pnpm test:differential 2>&1 | tail -10`
Expected: PASS.

- [ ] **Step 7: Run the spineless structural fuzzer (and any mutation fuzzer in the area).**

Run: `pnpm test packages/core/src/algorithm/spineless/spineless-structural.fuzz.test.ts packages/core/src/algorithm/spineless/runtime-mutation.test.ts packages/core/src/algorithm/spineless/runtime-incremental.fuzz.test.ts 2>&1 | tail -15`

Expected: PASS. If failures: a position-edge mutation isn't propagating through the dirtier; investigate.

- [ ] **Step 8: Commit.**

```bash
git add packages/core/src/algorithm/spineless/style-dirty.ts
git commit -m "feat(core): spineless dirtier dispatches position edge mutations (#150)"
```

(If Step 4 surfaced consumer-side fixes, they go in the same commit.)

---

## Task 10: Whole-repo verification

- [ ] **Step 1: Lint.**

Run: `pnpm lint`
Expected: PASS. If JSON fixtures need formatting, `pnpm format` and re-commit under `style: ...`.

- [ ] **Step 2: Full test pass.**

Run: `pnpm test`
Expected: PASS. Compare passing count to pre-PR baseline (1683 + 2 unit + 4 new fixtures + 3 reinstated = 1692).

- [ ] **Step 3: Differential.**

Run: `pnpm test:differential`
Expected: PASS.

- [ ] **Step 4: Typecheck.**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Bench (sanity-check no regression).**

Run: `pnpm bench 2>&1 | tail -30`
Expected: numbers within per-PR noise budget. The new code path adds one branch + one `undefined`-check per in-flow child per layout pass. Per memory `feedback_pilates_ci_bench_variance`, the floor is 5× dev-local; expect no perceptible move.

- [ ] **Step 6: Full ci script.**

Run: `pnpm run ci` (NOT `pnpm ci` — see memory `feedback_pnpm_script_name_collisions`)
Expected: PASS.

---

## Task 11: Remove `DEFERRED-FIXTURES.md`

**Files:**
- Delete: `DEFERRED-FIXTURES.md`

- [ ] **Step 1: Verify file's only deferred section is the position-edges one.**

Run: `cat DEFERRED-FIXTURES.md`
Expected: only the position-edges block exists. If other deferred entries appeared (they shouldn't have — this PR didn't author new fixtures elsewhere), DO NOT delete the file; instead remove only the position-edges section.

- [ ] **Step 2: Delete the file.**

Run: `git rm DEFERRED-FIXTURES.md`

- [ ] **Step 3: Commit.**

```bash
git commit -m "test(core): remove DEFERRED-FIXTURES.md — all deferred fixtures reinstated (#150)"
```

---

## Task 12: Push branch and open PR (closes #150)

- [ ] **Step 1: Push.**

```bash
git push -u origin feat/relative-position-offsets
```

- [ ] **Step 2: Open PR with `Closes #150`.**

```bash
gh pr create --base main --title "feat(core): apply position edges on positionType: relative (closes #150)" --body "$(cat <<'EOF'
## Summary

Implements relative-position offset application in both Pilates layout engines, matching Yoga 3.x and the CSS spec. Reinstates 3 deferred fixtures and adds 4 new ones in `packages/core/test/fixtures/position-edges/`.

Closes #150.

## Behavior

For an in-flow child with `positionType: 'relative'` (the default) and any of `positionTop/Right/Bottom/Left` set:
- The node's `left/top` are shifted by the offset.
- Siblings' flow positions are NOT disturbed.
- Width / height are unchanged.
- Tiebreak when opposing edges set: **start edge wins** (left over right, top over bottom).

## Changes

- `packages/core/src/algorithm/main-axis.ts` — new `applyRelativeOffset(child)` helper called after `layoutFlexFlow`.
- `packages/core/src/algorithm/spineless/flex-grammar.ts` — new `positionInput(node, edge)` leaf Field + `applyRelativePositionOffset` wrapper that augments `mainPosField` / `crossPosField` rules.
- `packages/core/src/algorithm/spineless/style-dirty.ts` — `'position'` added to `EdgeStyleProp`; dispatcher extended.
- `packages/core/src/algorithm/layout.test.ts` — sibling-flow invariant + tiebreak unit tests.
- `packages/core/test/fixtures/position-edges/` — 3 reinstated + 4 new fixtures.
- `DEFERRED-FIXTURES.md` deleted (no fixtures remain deferred).

## Test plan

- [x] `pnpm test`
- [x] `pnpm test:differential`
- [x] `pnpm typecheck`
- [x] `pnpm lint`
- [x] `pnpm bench` — no regression
- [x] `pnpm run ci`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Return the PR URL.**

---

## Self-review notes

**Spec coverage check:**
- Classic engine fix → Task 1
- Sibling invariant test → Task 2
- 3 deferred reinstated → Task 3
- 4 new fixtures → Task 4
- Spineless engine fix → Tasks 6–9
- Cache invalidation → Task 9
- `DEFERRED-FIXTURES.md` cleanup → Task 11
- Bench sanity → Task 10 step 5
- DoD all-green → Task 10

**Memory pointers used:**
- `feedback_pilates_typecheck_command` — `pnpm typecheck`, not `tsc -b`.
- `feedback_pilates_branch_pr_workflow` — branch + PR.
- `feedback_pilates_validation_infra_pays_off` — fuzzer wins when reasoning disagrees.
- `feedback_pilates_ci_bench_variance` — 5× dev-local bench tolerance.
- `feedback_pnpm_script_name_collisions` — `pnpm run ci`, not `pnpm ci`.
- `project_pilates_relative_position_gap` — the gap this PR closes.
