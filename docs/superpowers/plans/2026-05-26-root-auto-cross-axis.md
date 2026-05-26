# Root Auto-Cross-Axis Sizing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an engine-agnostic post-layout step that, for a root with `auto` on an axis and no `available` size, writes the content-derived size back into `root._layout`. Partial fix for issue #157 (root path; inner-container path stays open).

**Architecture:** New `autoSizeRootFromContent(root, available)` in `main-axis.ts`. Called from `calculateLayoutImpl` in `index.ts` between `layoutChildren(root)` and `roundLayout(root)`. Reads child positions/sizes, computes `max(child outer-edge) + padEnd`, clamps via existing `clampSize`, writes to `root._layout.{width|height}`.

**Tech Stack:** TypeScript, vitest, pnpm.

**Spec:** `docs/superpowers/specs/2026-05-26-root-auto-cross-axis-design.md`
**Branch:** `fix/root-auto-cross-axis` (already created from `c7cc141`, spec committed at `82dfca9`).
**Closes:** partial of #157.

---

## File Structure

| Path | Change | Responsibility |
|---|---|---|
| `packages/core/src/algorithm/main-axis.ts` | modify | New private `autoSizeRootFromContent`. |
| `packages/core/src/algorithm/index.ts` | modify | Call site in `calculateLayoutImpl` between layoutChildren + roundLayout. |
| `packages/core/src/algorithm/layout.test.ts` | modify | 5 new unit tests. |
| `packages/core/test/fixtures/flex-wrap/*.spec.json` | create | 8 ported fixtures (root-only deferred from PR #156). |
| `docs/superpowers/plans/2026-05-26-root-auto-cross-axis.md` | this file. |

---

## Task 1: Add `autoSizeRootFromContent` helper

**Files:**
- Modify: `packages/core/src/algorithm/main-axis.ts`

- [ ] **Step 1: Locate the insertion point.**

Run:
```bash
grep -n "^export function resolveRootAxisSize\|^function naturalCrossSize" packages/core/src/algorithm/main-axis.ts
```
Expected: `resolveRootAxisSize` at 1062, `naturalCrossSize` at 1006. Insert the new function immediately AFTER `resolveRootAxisSize` (top-level), before the end of the file.

- [ ] **Step 2: Read the current end of the file to find a stable insertion anchor.**

Run:
```bash
tail -5 packages/core/src/algorithm/main-axis.ts
```

- [ ] **Step 3: Append `autoSizeRootFromContent` to the file.**

Use Edit to append the following AFTER the closing `}` of `resolveRootAxisSize`:

```ts

/**
 * After `layoutChildren(root)` has positioned the root's children but before
 * rounding, write the content-derived size into the root's auto axes.
 *
 * Fires only when both:
 *   - `root.style[axis]` is `'auto'` AND not derivable from aspectRatio, AND
 *   - the caller passed no `available` size for that axis.
 *
 * For each such axis, sums in-flow children's outer edges (skipping absolute
 * and `display:'none'`) and adds the root's padding-end. Children's
 * positions already include padding-start from the flex pipeline's step 8,
 * so the sum measured from the root's outer corner already covers padStart +
 * inner content. Result is clamped via `clampSize` so min/max styles apply.
 *
 * Engine-agnostic: both the classic engine and the spineless engine write
 * children's positions/sizes into `node._layout` before this runs, so a
 * single post-step covers both.
 *
 * Partial fix for issue #157 — root path only. The inner-container case
 * (a non-root container with auto cross reporting 0 to its parent via
 * `naturalCrossSize`) requires a two-phase recursion model and stays open
 * as a separate milestone.
 */
export function autoSizeRootFromContent(
  root: Node,
  available: { width?: number; height?: number } | undefined,
): void {
  if (axisIsBareZero(root, 'row', available?.width)) {
    root._layout.width = sumChildExtent(root, 'row');
  }
  if (axisIsBareZero(root, 'column', available?.height)) {
    root._layout.height = sumChildExtent(root, 'column');
  }
}

/** True iff `axis`'s size on `root` will fall through to the zero default. */
function axisIsBareZero(root: Node, axis: Axis, available: number | undefined): boolean {
  if (available !== undefined) return false;
  const sizeStyle = effectivePreferredSize(root.style, axis);
  return sizeStyle !== 'number' && typeof sizeStyle !== 'number';
}

/** Max outer-edge of in-flow children + padEnd, clamped to root's min/max. */
function sumChildExtent(root: Node, axis: Axis): number {
  let maxEdge = 0;
  for (let i = 0; i < root.getChildCount(); i++) {
    const c = root.getChild(i)!;
    if (c.style.display === 'none') continue;
    if (c.style.positionType === 'absolute') continue;
    const edge =
      axis === 'row' ? c.layout.left + c.layout.width : c.layout.top + c.layout.height;
    if (edge > maxEdge) maxEdge = edge;
  }
  const padEnd = readEnd(root.style.padding, axis);
  return clampSize(root.style, axis, maxEdge + padEnd);
}
```

Notes for the engineer:
- `axisIsBareZero` mirrors `rootAxisIsBareZero` in `flex-grammar.ts:431`. The naming `axisIsBareZero` (without `root` prefix) is fine because this helper is local to the file and only ever called from `autoSizeRootFromContent`.
- The function checks `sizeStyle !== 'number'` twice — that's a leftover from a draft; collapse it to just `typeof sizeStyle !== 'number'`. The `effectivePreferredSize` returns `number | 'auto'`, so `typeof === 'number'` is sufficient.

Use this correct version for Step 3 instead — replacing only `axisIsBareZero`:

```ts
function axisIsBareZero(root: Node, axis: Axis, available: number | undefined): boolean {
  if (available !== undefined) return false;
  const sizeStyle = effectivePreferredSize(root.style, axis);
  return typeof sizeStyle !== 'number';
}
```

- [ ] **Step 4: Typecheck.**

Run: `pnpm typecheck`
Expected: PASS. If TS complains about `Axis` not being in scope, it should already be — `effectivePreferredSize` uses it. If `readEnd` isn't imported, check the existing imports at the top of the file; it's already imported (`endEdge` and `readEnd` are used in `layoutFlexFlow`).

- [ ] **Step 5: Run existing tests to confirm no regression.**

Run: `pnpm test packages/core/src/algorithm/`
Expected: existing tests pass (no behavior change yet — the helper isn't called).

- [ ] **Step 6: Commit.**

```bash
git add packages/core/src/algorithm/main-axis.ts
git commit -m "feat(core): add autoSizeRootFromContent helper (#157)"
```

---

## Task 2: Wire `autoSizeRootFromContent` into `calculateLayoutImpl`

**Files:**
- Modify: `packages/core/src/algorithm/index.ts`

- [ ] **Step 1: Locate the call site.**

Open `packages/core/src/algorithm/index.ts`. The cold path is around line 222–233:

```ts
  // Cold path
  root._layout.left = 0;
  root._layout.top = 0;
  root._floatLeft = 0;
  root._floatTop = 0;
  root._layout.width = resolveRootAxisSize(root, 'row', availableWidth);
  root._layout.height = resolveRootAxisSize(root, 'column', availableHeight);

  layoutChildren(root);
  roundLayout(root);
  computeScrollSizes(root, populateCache);
  markClean(root);
```

- [ ] **Step 2: Add the call between `layoutChildren` and `roundLayout`.**

Use Edit to change:

```ts
  layoutChildren(root);
  roundLayout(root);
```

to:

```ts
  layoutChildren(root);
  autoSizeRootFromContent(root, { width: availableWidth, height: availableHeight });
  roundLayout(root);
```

- [ ] **Step 3: Update the imports at the top of `index.ts` to include `autoSizeRootFromContent`.**

Find the existing import line for `main-axis.ts`. It's likely something like:

```ts
import { layoutChildren, resolveRootAxisSize } from './main-axis.js';
```

Change to:

```ts
import { autoSizeRootFromContent, layoutChildren, resolveRootAxisSize } from './main-axis.js';
```

If the import is split across multiple lines, just add `autoSizeRootFromContent` in alphabetical order.

- [ ] **Step 4: Typecheck.**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Run the full test suite to capture any incidental change.**

Run: `pnpm test`
Expected: PASS. **Watch for any test that asserted the OLD broken behavior** (root with `auto` axis returning 0) — those tests now legitimately need updating because the behavior is correct now. If any test fails, read its body: if the test was checking "root width = 0 when no available passed", change the expected to the content-derived value. Document such changes in the commit message.

- [ ] **Step 6: Commit.**

```bash
git add packages/core/src/algorithm/index.ts
git commit -m "feat(core): wire autoSizeRootFromContent post-step in cold path (#157)"
```

If any tests needed updating in step 5, include them in the same commit and call them out in the commit body.

---

## Task 3: Unit tests for auto-sized root

**Files:**
- Modify: `packages/core/src/algorithm/layout.test.ts`

- [ ] **Step 1: Verify `Node` and any helpers needed are already imported.**

Run: `head -20 packages/core/src/algorithm/layout.test.ts`
Expected to see `import { Node } from '../node.js';`. If `Edge` is also needed for setPosition (used in one test), confirm it's imported too.

- [ ] **Step 2: Append the test block.**

Append to the END of `packages/core/src/algorithm/layout.test.ts`:

```ts
describe('root auto cross-axis sizing (#157)', () => {
  it('non-wrap row sums child height into auto root height', () => {
    const root = Node.create();
    root.setFlexDirection('row');
    root.setWidth(100);
    const kid = Node.create();
    kid.setWidth(30);
    kid.setHeight(30);
    root.insertChild(kid, 0);
    root.calculateLayout();
    expect(root.getComputedLayout()).toMatchObject({ width: 100, height: 30 });
    expect(kid.getComputedLayout()).toMatchObject({ width: 30, height: 30 });
  });

  it('non-wrap column sums child width into auto root width', () => {
    const root = Node.create();
    root.setFlexDirection('column');
    root.setHeight(100);
    const kid = Node.create();
    kid.setWidth(30);
    kid.setHeight(30);
    root.insertChild(kid, 0);
    root.calculateLayout();
    expect(root.getComputedLayout()).toMatchObject({ width: 30, height: 100 });
  });

  it('wrap row sums all wrapped lines into auto root height', () => {
    const root = Node.create();
    root.setFlexDirection('row');
    root.setFlexWrap('wrap');
    root.setWidth(100);
    for (let i = 0; i < 4; i++) {
      const c = Node.create();
      c.setWidth(30);
      c.setHeight(30);
      root.insertChild(c, i);
    }
    root.calculateLayout();
    // 3 children fit on line 1 (90 width), 4th wraps to line 2.
    // Both lines have cross size 30; root height = 60.
    expect(root.getComputedLayout().height).toBe(60);
  });

  it('root padding is included in auto-sum', () => {
    const root = Node.create();
    root.setFlexDirection('row');
    root.setWidth(100);
    root.setPadding(Edge.All, 5);
    const kid = Node.create();
    kid.setWidth(30);
    kid.setHeight(30);
    root.insertChild(kid, 0);
    root.calculateLayout();
    // child at top=5 (padStart), height=30 → bottom edge = 35. Plus padEnd 5 → 40.
    expect(root.getComputedLayout().height).toBe(40);
  });

  it('minHeight clamps auto-sum upward when content is smaller', () => {
    const root = Node.create();
    root.setFlexDirection('row');
    root.setWidth(100);
    root.setMinHeight(50);
    const kid = Node.create();
    kid.setWidth(30);
    kid.setHeight(10);
    root.insertChild(kid, 0);
    root.calculateLayout();
    // content sums to 10, min-clamps to 50.
    expect(root.getComputedLayout().height).toBe(50);
  });
});
```

- [ ] **Step 3: Run the tests.**

Run: `pnpm test packages/core/src/algorithm/layout.test.ts`
Expected: 5 new tests pass (in addition to whatever was there before).

- [ ] **Step 4: If any of the 5 fails, debug. Most likely causes:**
  - Padding edge index mismatch — verify `readEnd` reads `padding[1]` for row and `padding[2]` for column (Edge.Right=1, Edge.Bottom=2). The existing `readEnd` should handle this correctly.
  - `setMinHeight` vs `setMinWidth` confusion.
  - Child cross stretching to 0 because `containerCross` was 0 at first pass — the auto-sum still happens correctly because children's `_layout.{height|width}` is what we read, and explicit child sizes survive stretch (only `'auto'` cross gets stretched to line size).

- [ ] **Step 5: Commit.**

```bash
git add packages/core/src/algorithm/layout.test.ts
git commit -m "test(core): unit tests for root auto-cross sizing (#157)"
```

---

## Task 4: Reinstate root-only deferred fixtures from PR #156

**Files:**
- Create: `packages/core/test/fixtures/flex-wrap/wrap-row-align-items-flex-end.spec.json`
- Create: `packages/core/test/fixtures/flex-wrap/wrap-row-align-items-center.spec.json`
- Create: `packages/core/test/fixtures/flex-wrap/wrap-min-main-overrides-flex-basis.spec.json`
- Create: `packages/core/test/fixtures/flex-wrap/wrap-reverse-align-content-flex-start.spec.json`
- Create: `packages/core/test/fixtures/flex-wrap/wrap-reverse-align-content-center.spec.json`
- Create: `packages/core/test/fixtures/flex-wrap/wrap-reverse-single-line-different-size.spec.json`
- Create: `packages/core/test/fixtures/flex-wrap/wrap-reverse-align-content-stretch.spec.json`
- Create: `packages/core/test/fixtures/flex-wrap/wrap-reverse-align-content-space-around.spec.json`
- Create: `packages/core/test/fixtures/flex-wrap/wrap-with-min-cross-axis.spec.json`
- Create: `packages/core/test/fixtures/flex-wrap/wrap-with-max-cross-axis.spec.json`

These are the fixtures from PR #156's deferred list where the ROOT has only `width` set (or only `height` set) and no `available` is passed. After Task 2, these should now produce engine-matching outputs.

- [ ] **Step 1: For each fixture above, run the reduction tool to emit the .spec.json.**

The Yoga source HTML is at `C:/Users/wangz/AppData/Local/Temp/yoga/gentest/fixtures/YGFlexWrapTest.html` (per the earlier port). For each fixture in the list above, find the matching `<div id="...">` in the Yoga source, translate the inline CSS to a Pilates SpecNode JSON, write it to a temp file, and run:

```bash
pnpm tsx tools/reduce-fixture.ts /tmp/in.json --tag flex-wrap --name "flex-wrap/<output-name-without-spec-json>" --out packages/core/test/fixtures/flex-wrap/<output-name>.spec.json
```

Example for `wrap-row-align-items-flex-end`:

Yoga source (lines 15–20 of YGFlexWrapTest.html):
```html
<div id="wrap_row_align_items_flex_end" style="width: 100px; flex-direction: row; flex-wrap: wrap; align-items: flex-end;">
  <div style="height: 10px; width: 30px;"></div>
  <div style="height: 20px; width: 30px;"></div>
  <div style="height: 30px; width: 30px;"></div>
  <div style="height: 30px; width: 30px;"></div>
</div>
```

Pilates SpecNode JSON (`/tmp/in.json`):
```json
{
  "style": { "flexDirection": "row", "flexWrap": "wrap", "width": 100, "alignItems": "flex-end" },
  "children": [
    { "style": { "width": 30, "height": 10 } },
    { "style": { "width": 30, "height": 20 } },
    { "style": { "width": 30, "height": 30 } },
    { "style": { "width": 30, "height": 30 } }
  ]
}
```

(The tool auto-assigns ids `n0`, `n1`, …)

Command:
```bash
pnpm tsx tools/reduce-fixture.ts /tmp/in.json --tag flex-wrap --name "flex-wrap/wrap-row-align-items-flex-end" --out packages/core/test/fixtures/flex-wrap/wrap-row-align-items-flex-end.spec.json
```

If the tool prints "⚠ Pilates and Yoga produced different layouts": that fixture is NOT root-only divergence; it has inner-container auto-cross too. **Defer it** — delete the emitted .spec.json and skip it in this PR.

Repeat for each fixture in the list. The Yoga ids are (per the original `YGFlexWrapTest.html`):
- `wrap_row_align_items_flex_end` → `wrap-row-align-items-flex-end.spec.json`
- `wrap_row_align_items_center` → `wrap-row-align-items-center.spec.json`
- `flex_wrap_children_with_min_main_overriding_flex_basis` → `wrap-min-main-overrides-flex-basis.spec.json`
- `wrap_reverse_row_align_content_flex_start` → `wrap-reverse-align-content-flex-start.spec.json`
- `wrap_reverse_row_align_content_center` → `wrap-reverse-align-content-center.spec.json`
- `wrap_reverse_row_single_line_different_size` → `wrap-reverse-single-line-different-size.spec.json`
- `wrap_reverse_row_align_content_stretch` → `wrap-reverse-align-content-stretch.spec.json`
- `wrap_reverse_row_align_content_space_around` → `wrap-reverse-align-content-space-around.spec.json`
- `wrap_with_min_cross_axis` → `wrap-with-min-cross-axis.spec.json`
- `wrap_with_max_cross_axis` → `wrap-with-max-cross-axis.spec.json`

CSS-to-SpecStyle mapping reminder:
- `width: Npx` → `"width": N`
- `flex-direction: row` → `"flexDirection": "row"`
- `flex-wrap: wrap-reverse` → `"flexWrap": "wrap-reverse"`
- `align-items: flex-end` → `"alignItems": "flex-end"`
- `align-content: <v>` → `"alignContent": "<v>"`
- `min-height: Npx` / `max-height: Npx` → `"minHeight": N` / `"maxHeight": N`
- `flex-basis: Npx` / `min-width: Npx` → camelCase equivalents

- [ ] **Step 2: Run the fixture suite. Expect ALL ported fixtures to pass.**

Run: `pnpm test packages/core/test/fixtures.test.ts`
Expected: 69 (current count) + N (number actually committed) passing.

- [ ] **Step 3: Apply biome format to the new JSON files.**

Run: `pnpm format`
Expected: re-formats any JSON drift; no other files should change.

- [ ] **Step 4: Commit.**

```bash
git add packages/core/test/fixtures/flex-wrap/
git commit -m "test(core): reinstate root-auto-cross fixtures (#157)"
```

If you deferred any fixtures from the list (inner auto-cross failures), say so in the commit body.

---

## Task 5: Whole-repo verification

- [ ] **Step 1: Lint.**

Run: `pnpm lint`
Expected: PASS.

- [ ] **Step 2: Test.**

Run: `pnpm test`
Expected: PASS.

- [ ] **Step 3: Differential test.**

Run: `pnpm test:differential`
Expected: PASS. Both engines now apply the post-step (same code, since it runs after engine-specific `layoutChildren`).

- [ ] **Step 4: Typecheck.**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Full CI script.**

Run: `pnpm run ci`
Expected: PASS.

---

## Task 6: Push + open PR (note: remote CI may still be blocked by Actions budget)

- [ ] **Step 1: Push.**

```bash
git push -u origin fix/root-auto-cross-axis
```

- [ ] **Step 2: Open PR.**

```bash
gh pr create --base main --title "fix(core): auto-size root cross axis from content (closes #157 root path)" --body "$(cat <<'EOF'
## Summary

Closes the ROOT half of issue #157. Adds an engine-agnostic post-layout step that, for a root with \`auto\` on an axis and no \`available\` size, writes the content-derived size (sum of in-flow children's outer edges + padEnd, clamped to min/max) back into \`root._layout\`.

Matches Yoga 3.x. The inner-container path (a non-root container with auto cross reporting 0 to its parent via \`naturalCrossSize\`) stays open — it requires a two-phase recursion model and is tracked as the Path B follow-up on #157.

## Changes

- \`packages/core/src/algorithm/main-axis.ts\` — new \`autoSizeRootFromContent\` + local helpers.
- \`packages/core/src/algorithm/index.ts\` — call \`autoSizeRootFromContent\` between \`layoutChildren(root)\` and \`roundLayout(root)\`.
- \`packages/core/src/algorithm/layout.test.ts\` — 5 unit tests.
- \`packages/core/test/fixtures/flex-wrap/*.spec.json\` — N reinstated fixtures from PR #156's deferred list.

## Test plan

- [x] \`pnpm test\`
- [x] \`pnpm test:differential\`
- [x] \`pnpm typecheck\`
- [x] \`pnpm lint\`
- [x] \`pnpm run ci\`

Closes the root path of #157.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Update issue #157 with a scoping comment.**

```bash
gh issue comment 157 --body "Root path closed by PR #<this PR number>. The inner-container case (a non-root container with \`naturalCrossSize === 0\` for non-leaf, non-aspect-ratio nodes) remains open — that requires a two-phase recursion model (Path B in the investigation comment) and will be tracked here."
```

- [ ] **Step 4: Return the PR URL.**

---

## Self-review notes

**Spec coverage:**
- Engine-agnostic post-step location → Task 2
- `autoSizeRootFromContent` + bare-zero predicate → Task 1
- Min/max clamp via existing `clampSize` → Task 1 (sumChildExtent uses it)
- 5 unit tests (non-wrap row, non-wrap column, wrap row, padding, minHeight) → Task 3
- Fixture reinstatement → Task 4
- Issue #157 comment → Task 6 step 3
- DoD all-green → Task 5

**Type consistency:** `autoSizeRootFromContent` matches the signature used in the call site (Task 2). Local helpers (`axisIsBareZero`, `sumChildExtent`) are private; their names don't leak.

**Memory pointers:**
- `feedback_pilates_typecheck_command` — `pnpm typecheck`.
- `feedback_pilates_branch_pr_workflow` — branch + PR.
- `feedback_pnpm_script_name_collisions` — `pnpm run ci` not `pnpm ci`.
- Remote CI may still be blocked by the Actions budget issue — local CI is the gate.
