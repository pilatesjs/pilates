# Root auto main-size + min-constraint `justifyContent` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Distribute a bare-auto root's children with `justifyContent` against the resolved (`clamp(content, min, max)`) main size instead of collapsing them to flex-start at `0`. Closes issue #165.

**Architecture:** The root's main size is resolved *after* its children are positioned (`resolveRootAxisSize` → `0` for bare-auto, then `autoSizeRootFromContent` clamps up later). The fix substitutes an `effectiveInnerMain = max(innerMain, clamp(content, min, max) − pads)` **at the positioning step only**, for a single-line bare-auto root main axis, in both engines. The classic engine threads a `rootMainAuto` flag from `index.ts`; the spineless engine bakes the same condition structurally via its existing `rootAxisIsBareZero` predicate and feeds the parent's min/max fields into `emitJustifiedMainPos`. The differential fuzzer enforces lockstep.

**Tech Stack:** TypeScript, Vitest, fast-check, yoga-layout (WASM oracle), pnpm.

**Branch:** `fix/root-min-justify-content` (already created, spec committed).

---

## Background facts (verified, do not re-investigate)

- **Engine routing** (`packages/core/src/algorithm/index.ts:103-110`): a root's **first** `calculateLayout()` uses the **classic/imperative** engine; the **second+** call uses the **spineless** engine. So a single-`calculateLayout` unit test exercises the classic engine; a test that calls `calculateLayout` **twice** exercises the spineless engine.
- **Classic free-space source** (`main-axis.ts:274`): `containerMain = sizeOnAxis(node, main)` reads `node.layout.{width|height}` (resolved). For a bare-auto root this is `0` until `autoSizeRootFromContent` runs (too late for positioning).
- **`axisIsBareZero`** (`main-axis.ts:1142`) is currently NOT exported. **`clampSize`** is from `./axis.js` and already imported in `main-axis.ts`. **`mainAxis`** is in `./axis.js`.
- **Spineless**: `rootAxisIsBareZero(n, axis)` (`flex-grammar.ts:440`, a `buildFlexGrammar` closure) = `style[axis]` not number AND not aspect-derivable AND `available[axis] === undefined`. The root's main-size field for the bare-auto case returns a bare unclamped value (`flex-grammar.ts:1072-1077`) by design — DO NOT change the size rule; mirror the classic fix in `emitJustifiedMainPos` instead. `clampMinMax(value, min, max)` (`flex-grammar.ts:2192`) is module-level (callable from `emitJustifiedMainPos`). `minMaxInput(n, prop)` (`flex-grammar.ts:480`) returns a `Field<number>` (max defaults to `+Infinity`).
- **`emitJustifiedMainPos`** (`flex-grammar.ts:2401`) handles the **no-wrap** justify path; it is called at `flex-grammar.ts:1266` and `:1355`. Both call sites are inside `buildFlexGrammar`, where `root` (the function's first param), `rootAxisIsBareZero`, and `minMaxInput` are all in scope.
- Both engines' fix is gated to the **single-line** case, so they stay differential-identical (a bare-auto main axis hugs content and does not wrap).

---

## Task 1: Failing unit tests (classic engine)

**Files:**
- Modify: `packages/core/src/algorithm/layout.test.ts` (append a new `describe` after the existing top-level describes; `Node` and `Edge` are already imported).

- [ ] **Step 1: Add the failing unit tests**

Append to `packages/core/src/algorithm/layout.test.ts`:

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

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `pnpm test -- packages/core/src/algorithm/layout.test.ts`
Expected: the 3 min-constraint tests FAIL (e.g. `kid.left` is `0`, expected `15`/`30`); the `no min` test PASSES (regression guard). Do NOT commit yet — Task 2 makes them pass.

---

## Task 2: Classic engine fix

**Files:**
- Modify: `packages/core/src/algorithm/main-axis.ts` (export `axisIsBareZero`; add `rootMainAuto` param to `layoutChildren` + `layoutFlexFlow`; substitute at positioning).
- Modify: `packages/core/src/algorithm/index.ts` (compute `rootMainAuto`, pass it into the cold-path `layoutChildren(root)` call; add imports).
- Test: `packages/core/src/algorithm/layout.test.ts` (Task 1 tests).

- [ ] **Step 1: Export `axisIsBareZero`**

In `packages/core/src/algorithm/main-axis.ts:1142`, change:

```ts
function axisIsBareZero(root: Node, axis: Axis, available: number | undefined): boolean {
```
to:
```ts
export function axisIsBareZero(root: Node, axis: Axis, available: number | undefined): boolean {
```

- [ ] **Step 2: Thread `rootMainAuto` into `layoutChildren`**

In `packages/core/src/algorithm/main-axis.ts:127`, change the signature:

```ts
export function layoutChildren(node: Node, useCache = false, parentAbsX = 0, parentAbsY = 0): void {
```
to:
```ts
export function layoutChildren(
  node: Node,
  useCache = false,
  parentAbsX = 0,
  parentAbsY = 0,
  rootMainAuto = false,
): void {
```

Then at the cold-path call (currently `main-axis.ts:183`), change:

```ts
    layoutFlexFlow(node, flowChildren);
```
to:
```ts
    layoutFlexFlow(node, flowChildren, rootMainAuto);
```

(The recursive `layoutChildren(c, ...)` calls and the cache-hit-path `layoutChildren(c, true, ...)` calls are left unchanged — they default `rootMainAuto` to `false`. Only the root, called from `index.ts`, passes `true`.)

- [ ] **Step 3: Substitute the effective main size at positioning in `layoutFlexFlow`**

In `packages/core/src/algorithm/main-axis.ts:270`, change the signature:

```ts
function layoutFlexFlow(node: Node, visible: readonly Node[]): void {
```
to:
```ts
function layoutFlexFlow(node: Node, visible: readonly Node[], rootMainAuto = false): void {
```

Then replace the Step 6 & 7 positioning loop (currently `main-axis.ts:317-321`):

```ts
  // Step 6 & 7: per-line item positioning and cross-alignment.
  for (const line of lines) {
    positionItemsInLine(line, node.style.justifyContent, innerMain, gapMain);
    crossAlignItemsInLine(line, node.style.alignItems, node.style.flexWrap);
  }
```
with:
```ts
  // Step 6 & 7: per-line item positioning and cross-alignment.
  //
  // Bare-auto root main axis (#165): the root's main size is still the
  // unresolved 0 here (resolveRootAxisSize returns 0 for auto + no available;
  // autoSizeRootFromContent clamps it up AFTER this runs). Mirror the non-root
  // path — a parent resolves a child's min-clamped main size before the child
  // distributes — by positioning against clamp(content, min, max) instead of 0.
  // Single-line only: a bare-auto main axis hugs content and never wraps, and
  // this keeps the classic and spineless engines differential-identical.
  let positionMain = innerMain;
  if (rootMainAuto && lines.length === 1) {
    let usedMain = 0;
    const items = lines[0]!.items;
    for (let i = 0; i < items.length; i++) {
      const it = items[i]!;
      usedMain += it.finalMain + it.marginMainStart + it.marginMainEnd;
      if (i < items.length - 1) usedMain += gapMain;
    }
    const clamped =
      clampSize(node.style, main, usedMain + padMainStart + padMainEnd) - padMainStart - padMainEnd;
    positionMain = Math.max(innerMain, clamped);
  }
  for (const line of lines) {
    positionItemsInLine(line, node.style.justifyContent, positionMain, gapMain);
    crossAlignItemsInLine(line, node.style.alignItems, node.style.flexWrap);
  }
```

(Leave Step 8's `writeMainPos`/`writeMainSize` loop and the `flipMainAxis` reverse handling unchanged — they keep using `innerMain`. Reverse + bare-auto-root is out of scope and stays identical across both engines, so the differential fuzzer is unaffected.)

- [ ] **Step 4: Compute and pass `rootMainAuto` from `index.ts`**

In `packages/core/src/algorithm/index.ts`, add an import near the existing `./main-axis.js` import (line 29) and an `./axis.js` import:

```ts
import { mainAxis } from './axis.js';
```
and change line 29 to add `axisIsBareZero`:
```ts
import {
  autoSizeRootFromContent,
  axisIsBareZero,
  layoutChildren,
  resolveRootAxisSize,
} from './main-axis.js';
```

Then in the cold path, replace (currently `index.ts:243`):

```ts
  layoutChildren(root);
```
with:
```ts
  // #165: tell the flex pipeline when the root's MAIN axis is bare-auto
  // (style auto, no aspect-derivation, no caller-supplied available), so it
  // positions children with justify-content against clamp(content, min, max)
  // instead of the not-yet-resolved 0.
  const rootMain = mainAxis(root.style.flexDirection);
  const rootMainAvailable = rootMain === 'row' ? availableWidth : availableHeight;
  const rootMainAuto = axisIsBareZero(root, rootMain, rootMainAvailable);
  layoutChildren(root, false, 0, 0, rootMainAuto);
```

- [ ] **Step 5: Run the unit tests — expect PASS**

Run: `pnpm test -- packages/core/src/algorithm/layout.test.ts`
Expected: all tests PASS, including the 3 from Task 1 that previously failed.

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 7: Commit (classic engine)**

NOTE: `pnpm test:differential` will FAIL between this commit and Task 3 — the spineless engine is not yet fixed, so the engines diverge on the new behavior. That is expected and resolved in Task 3. Verify only `pnpm test` (default engine) here.

Run: `pnpm test -- packages/core/src/algorithm/layout.test.ts` (PASS), then:

```bash
git add packages/core/src/algorithm/main-axis.ts packages/core/src/algorithm/index.ts packages/core/src/algorithm/layout.test.ts
git commit -m "fix(core): classic engine positions justify-content against min-resolved root main size (#165)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Spineless engine fix

**Files:**
- Modify: `packages/core/src/algorithm/spineless/flex-grammar.ts` (add min/max params to `emitJustifiedMainPos`; substitute `effInnerMain`; pass the parent's min/max fields at the two call sites under the bare-auto-root gate).
- Test: `packages/core/src/algorithm/layout.test.ts` (add a spineless-path test).

- [ ] **Step 1: Add min/max params + substitution to `emitJustifiedMainPos`**

In `packages/core/src/algorithm/spineless/flex-grammar.ts:2401`, extend the signature — add two params at the end:

```ts
function emitJustifiedMainPos(
  grammar: Grammar,
  parent: Node,
  mainPosField: Field<unknown>,
  mainSizeName: 'width' | 'height',
  justify: Justify,
  indexInParent: number,
  direction: 'row' | 'column',
  gapField: Field<number>,
  padStartField: Field<number>,
  padEndField: Field<number>,
  marginInput: (n: Node, edge: number) => Field<number>,
  rootMinMain: Field<number> | null,
  rootMaxMain: Field<number> | null,
): void {
```

In the `deps` array (currently ends with the spread `marginEnds`), append the two new fields when present. Change the `deps` array to:

```ts
    deps: [
      parentMainField as Field<unknown>,
      gapField as Field<unknown>,
      padStartField as Field<unknown>,
      padEndField as Field<unknown>,
      ...(allSizes as Field<unknown>[]),
      ...(marginStarts as Field<unknown>[]),
      ...(marginEnds as Field<unknown>[]),
      ...(rootMinMain !== null ? [rootMinMain as Field<unknown>] : []),
      ...(rootMaxMain !== null ? [rootMaxMain as Field<unknown>] : []),
    ],
```

Inside `compute`, replace the leftover computation (currently):

```ts
      const innerMain = Math.max(0, read(parentMainField) - padStart - read(padEndField));
      let usedMain = 0;
      for (let i = 0; i < n; i++) {
        usedMain += read(allSizes[i]!) + read(marginStarts[i]!) + read(marginEnds[i]!);
      }
      if (n > 1) usedMain += (n - 1) * gap;
      // Signed leftover — negative on overflow. flex-end/center honor; space-*
      // clamp to 0 (degrades to flex-start on overflow). Mirrors imperative
      // `positionItemsInLine`. (#164)
      const leftover = innerMain - usedMain;
```
with:
```ts
      const padEnd = read(padEndField);
      let innerMain = Math.max(0, read(parentMainField) - padStart - padEnd);
      let usedMain = 0;
      for (let i = 0; i < n; i++) {
        usedMain += read(allSizes[i]!) + read(marginStarts[i]!) + read(marginEnds[i]!);
      }
      if (n > 1) usedMain += (n - 1) * gap;
      // Bare-auto root main axis (#165): the root's main size is the
      // unresolved 0 here (autoSizeRootFromContent clamps it up later). Mirror
      // the imperative fix — position against clamp(content, min, max) instead
      // of 0. Only emitted when the parent is the bare-auto root (rootMinMain
      // non-null), so non-root and concrete-size paths are byte-identical.
      if (rootMinMain !== null) {
        const clamped = clampMinMax(
          usedMain + padStart + padEnd,
          read(rootMinMain),
          rootMaxMain !== null ? read(rootMaxMain) : Number.POSITIVE_INFINITY,
        );
        innerMain = Math.max(innerMain, clamped - padStart - padEnd);
      }
      // Signed leftover — negative on overflow. flex-end/center honor; space-*
      // clamp to 0 (degrades to flex-start on overflow). Mirrors imperative
      // `positionItemsInLine`. (#164)
      const leftover = innerMain - usedMain;
```

(`innerMain` changes from `const` to `let`; the `leftoverPositive`/`switch`/cursor logic below is unchanged.)

- [ ] **Step 2: Pass the min/max fields at the first call site**

At `packages/core/src/algorithm/spineless/flex-grammar.ts:1266` (the `else` branch of the `indexInParent === 0` block), replace:

```ts
        emitJustifiedMainPos(
          grammar,
          parent,
          mainPosField,
          mainSizeName,
          justify,
          indexInParent,
          parentDirection!,
          gapInput(parent, parentDirection === 'column' ? 'row' : 'column'),
          padMainStartF!,
          padMainEndF!,
          marginInput,
        );
```
with:
```ts
        {
          const rootMainAuto = parent === root && rootAxisIsBareZero(parent, mainSizeName);
          const rootMinMain = rootMainAuto
            ? minMaxInput(parent, mainSizeName === 'width' ? 'minWidth' : 'minHeight')
            : null;
          const rootMaxMain = rootMainAuto
            ? minMaxInput(parent, mainSizeName === 'width' ? 'maxWidth' : 'maxHeight')
            : null;
          emitJustifiedMainPos(
            grammar,
            parent,
            mainPosField,
            mainSizeName,
            justify,
            indexInParent,
            parentDirection!,
            gapInput(parent, parentDirection === 'column' ? 'row' : 'column'),
            padMainStartF!,
            padMainEndF!,
            marginInput,
            rootMinMain,
            rootMaxMain,
          );
        }
```

- [ ] **Step 3: Pass the min/max fields at the second call site**

At `packages/core/src/algorithm/spineless/flex-grammar.ts:1355` (the final `else` branch), replace:

```ts
    } else {
      emitJustifiedMainPos(
        grammar,
        parent,
        mainPosField,
        mainSizeName,
        justify,
        indexInParent,
        parentDirection!,
        gapInput(parent, parentDirection === 'column' ? 'row' : 'column'),
        padMainStartF!,
        padMainEndF!,
        marginInput,
      );
    }
```
with:
```ts
    } else {
      const rootMainAuto = parent === root && rootAxisIsBareZero(parent, mainSizeName);
      const rootMinMain = rootMainAuto
        ? minMaxInput(parent, mainSizeName === 'width' ? 'minWidth' : 'minHeight')
        : null;
      const rootMaxMain = rootMainAuto
        ? minMaxInput(parent, mainSizeName === 'width' ? 'maxWidth' : 'maxHeight')
        : null;
      emitJustifiedMainPos(
        grammar,
        parent,
        mainPosField,
        mainSizeName,
        justify,
        indexInParent,
        parentDirection!,
        gapInput(parent, parentDirection === 'column' ? 'row' : 'column'),
        padMainStartF!,
        padMainEndF!,
        marginInput,
        rootMinMain,
        rootMaxMain,
      );
    }
```

- [ ] **Step 4: Add a spineless-path unit test**

Append to the `describe('root auto main-size from min-constraint (#165)', ...)` block in `packages/core/src/algorithm/layout.test.ts` (laying out twice routes the second pass through the spineless engine):

```ts
  it('spineless engine (2nd layout) matches: center within min-width root', () => {
    const root = Node.create();
    root.setFlexDirection('row');
    root.setJustifyContent('center');
    root.setMinWidth(50);
    const kid = Node.create();
    kid.setWidth(20);
    kid.setHeight(20);
    root.insertChild(kid, 0);
    root.calculateLayout(); // 1st: classic
    root.calculateLayout(); // 2nd: spineless
    expect(root.getComputedLayout().width).toBe(50);
    expect(kid.getComputedLayout().left).toBe(15);
  });
```

- [ ] **Step 5: Run the unit tests — expect PASS**

Run: `pnpm test -- packages/core/src/algorithm/layout.test.ts`
Expected: all PASS (including the new spineless test).

- [ ] **Step 6: Run the differential suite — expect PASS**

Run: `pnpm test:differential`
Expected: all PASS — both engines now agree. If a fuzzer seed fails, reproduce it, pin a regression fixture via the failing seed, fix, then unpin (per the project's fuzzer protocol). Do not weaken assertions.

- [ ] **Step 7: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 8: Commit (spineless engine)**

```bash
git add packages/core/src/algorithm/spineless/flex-grammar.ts packages/core/src/algorithm/layout.test.ts
git commit -m "fix(core): spineless engine mirrors min-resolved root justify-content (#165)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Reinstate the 2 deferred fixtures

**Files:**
- Create: `packages/core/test/fixtures/justify-content/row-min-width-and-margin.spec.json`
- Create: `packages/core/test/fixtures/justify-content/column-min-height-and-margin.spec.json`

Exact Yoga gentest source (verified from `facebook/yoga` `YGJustifyContentTest`):
- `justify_content_row_min_width_and_margin`: outer `min-width: 50px; margin-left: 100px; justify-content: center; flex-direction: row;`, one child `width: 20px; height: 20px;`.
- `justify_content_column_min_height_and_margin`: outer `min-height: 50px; margin-top: 100px; justify-content: center; flex-direction: column;`, one child `width: 20px; height: 20px;`.

- [ ] **Step 1: Author the input SpecNode for the row fixture**

Write to `/tmp/in-row-min.json`:

```json
{
  "id": "n0",
  "style": {
    "minWidth": 50,
    "marginLeft": 100,
    "justifyContent": "center",
    "flexDirection": "row"
  },
  "children": [
    { "id": "n1", "style": { "width": 20, "height": 20 } }
  ]
}
```

- [ ] **Step 2: Generate the row fixture via reduce-fixture**

Run:
```bash
pnpm tsx tools/reduce-fixture.ts /tmp/in-row-min.json --tag justify-content --name "justify-content/row-min-width-and-margin" --out packages/core/test/fixtures/justify-content/row-min-width-and-margin.spec.json
```
Expected: writes a `ConsensusFixture` (no divergence warning). If the tool warns that Pilates and Yoga diverge, the engine fix did not reach this case — STOP and investigate. Verify the emitted `expected` is:
- `n0`: `{ "left": 100, "top": 0, "width": 50, "height": 20 }`
- `n1`: `{ "left": 15, "top": 0, "width": 20, "height": 20 }`

- [ ] **Step 3: Author + generate the column fixture**

Write to `/tmp/in-col-min.json`:

```json
{
  "id": "n0",
  "style": {
    "minHeight": 50,
    "marginTop": 100,
    "justifyContent": "center",
    "flexDirection": "column"
  },
  "children": [
    { "id": "n1", "style": { "width": 20, "height": 20 } }
  ]
}
```

Run:
```bash
pnpm tsx tools/reduce-fixture.ts /tmp/in-col-min.json --tag justify-content --name "justify-content/column-min-height-and-margin" --out packages/core/test/fixtures/justify-content/column-min-height-and-margin.spec.json
```
Expected `expected`:
- `n0`: `{ "left": 0, "top": 100, "width": 20, "height": 50 }`
- `n1`: `{ "left": 0, "top": 15, "width": 20, "height": 20 }`

- [ ] **Step 4: Run the fixture suite (both modes)**

Run: `pnpm test -- packages/core/test/fixtures.test.ts`
Then: `cross-env PILATES_DIFFERENTIAL_LAYOUT=1 pnpm test -- packages/core/test/fixtures.test.ts`
Expected: both PASS; the two new fixtures are picked up (fixture count increases by 2).

- [ ] **Step 5: Lint (fixtures are JSON — biome may reformat)**

Run: `pnpm lint`
If it reports formatting on the new fixtures, run `pnpm format` and re-stage.

- [ ] **Step 6: Commit (fixtures)**

```bash
git add packages/core/test/fixtures/justify-content/row-min-width-and-margin.spec.json packages/core/test/fixtures/justify-content/column-min-height-and-margin.spec.json
git commit -m "test(core): reinstate 2 deferred min-width/min-height justify-content fixtures (#165)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Follow-up issue, full CI, and PR

- [ ] **Step 1: File the cross-axis follow-up issue**

The same root cause breaks the cross axis (root `minHeight` + `alignItems: center` → child stays at `top: 0` instead of 15). This PR scopes to the main axis only. File:

```bash
gh issue create --title "Pilates align-items ignored when cross-axis size resolved from min-width/min-height (root)" --body "$(cat <<'EOF'
## Summary

Cross-axis analog of #165 (which fixed the main axis). When a **root** flex
container's CROSS-axis size is `auto` and resolves upward from a min constraint,
`alignItems` collapses children to the cross-start edge instead of distributing
against the resolved cross size.

## Repro

```ts
const root = Node.create();
root.setFlexDirection('row');     // cross axis = column
root.setAlignItems('center');
root.setMinHeight(50);
const kid = Node.create();
kid.setWidth(20); kid.setHeight(20);
root.insertChild(kid, 0);
root.calculateLayout();
// Pilates: root.height = 50 but kid.top = 0
// Yoga:    kid.top = 15  ((50 - 20) / 2)
```

## Root cause

Same shape as #165: the root's cross size is `0` during `layoutFlexFlow`
(resolved up by `autoSizeRootFromContent` only afterward), so per-line
cross-sizing / `alignItems` runs against `0`. The main-axis fix (#165) deliberately
scoped to `justifyContent`; the cross path (line cross-sizing, `stretch`,
`align-content`) is more entangled and was deferred.

## Fix sketch

Mirror #165 on the cross axis: feed `clamp(contentCross, minCross, maxCross)`
into per-line cross sizing / `crossAlignItemsInLine` for a bare-auto root cross
axis, in both engines, verified by the differential fuzzer.

## Filed during

PR for #165 (root min-constraint justify-content).
EOF
)"
```

Record the issue number it prints.

- [ ] **Step 2: Run the full local CI gate**

Run: `pnpm run ci`
Expected: `lint → build → typecheck → test → test:differential` all green, exit 0. (Remote CI does not run — the pilatesjs org has a $0 Actions budget; local `pnpm run ci` is the merge gate.)

- [ ] **Step 3: Push the branch**

```bash
git push -u origin fix/root-min-justify-content
```

- [ ] **Step 4: Open the PR against `main`**

```bash
gh pr create --base main --head fix/root-min-justify-content --title "fix(core): justify-content honors min-resolved root main size (closes #165)" --body "$(cat <<'EOF'
## What

A bare-auto **root** container resolved its main size from `min-width`/`min-height`
*after* positioning its children, so `justify-content` collapsed them to
flex-start at `0` (root width became 50 but the child stayed at `left: 0`).
Yoga distributes within the resolved size.

## Fix

At the positioning step only, for a single-line bare-auto root main axis, both
engines now position against `max(innerMain, clamp(content, min, max) − pads)`:
- **Classic** (`index.ts` + `main-axis.ts`): threads a `rootMainAuto` flag
  (computed via the now-exported `axisIsBareZero`) into the flex pipeline.
- **Spineless** (`flex-grammar.ts`): feeds the root's min/max main fields into
  `emitJustifiedMainPos` under the existing `rootAxisIsBareZero` structural gate.

The `max(…)` guard makes the change a no-op for every concrete-size container;
the differential fuzzer confirms the engines stay in lockstep.

## Tests

- 5 unit tests in `layout.test.ts` (classic + spineless paths, plus a
  shrink-wrap regression guard).
- Reinstated the 2 fixtures PR #166 deferred:
  `row-min-width-and-margin`, `column-min-height-and-margin`.
- `pnpm run ci` green (lint → build → typecheck → test → test:differential).

## Scope / follow-up

Main axis (`justify-content`) only. The identical cross-axis (`align-items`)
symptom is tracked separately in #<CROSS_AXIS_ISSUE>.

Closes #165.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Replace `#<CROSS_AXIS_ISSUE>` with the number from Step 1.

- [ ] **Step 5: Report**

Report the PR URL and the follow-up issue number. The branch is ready for the user's force-merge once local CI is green.

---

## Self-review checklist (completed by plan author)

- **Spec coverage:** root-cause fix (Tasks 2–3), main-axis-only scope (gated `rootMainAuto`), both engines, differential verification (Task 3 Step 6), 4+1 unit tests (Tasks 1, 3), 2 reinstated fixtures (Task 4), cross-axis follow-up issue (Task 5 Step 1), full `pnpm run ci` + PR + close #165 (Task 5). ✔ all mapped.
- **Placeholder scan:** every code step shows exact code; fixture inputs + expected boxes are concrete; only `#<CROSS_AXIS_ISSUE>` is an intentional fill-from-output token. ✔
- **Type consistency:** `rootMainAuto: boolean` (classic) threaded `index.ts → layoutChildren → layoutFlexFlow`; `rootMinMain`/`rootMaxMain: Field<number> | null` (spineless) added to `emitJustifiedMainPos` and both call sites; `axisIsBareZero` exported before use; `clampSize`/`clampMinMax`/`minMaxInput`/`mainAxis` referenced match their real signatures. ✔
