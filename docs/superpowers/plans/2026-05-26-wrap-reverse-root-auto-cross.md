# Wrap-Reverse Root Auto-Cross — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `autoSizeRootFromContent` (from PR #158) so a wrap-reverse root with bare-zero auto cross shifts its in-flow children to non-negative positions and reports a content-derived cross size.

**Architecture:** Modify `sumChildExtent` in `main-axis.ts` to return both `extent` (max - min) and `shift` (how far to translate children). When shift > 0, write the translation into each in-flow child's `_layout` and `_floatLeft/_floatTop`. Engine-agnostic: the post-step is already invoked from classic cold path + spineless `finishWhole` + spineless `finishMoved`.

**Tech Stack:** TypeScript, vitest, pnpm.

**Spec:** `docs/superpowers/specs/2026-05-26-wrap-reverse-root-auto-cross-design.md`
**Branch:** `fix/wrap-reverse-root-auto-cross` (already created from `3873be4`; spec committed at `3e9834e`).
**Closes:** the wrap-reverse follow-up flagged in PR #158; advances issue #157.

---

## File Structure

| Path | Change | Responsibility |
|---|---|---|
| `packages/core/src/algorithm/main-axis.ts` | modify | `sumChildExtent` returns `{ extent, shift }`; new private `shiftChildren`; `autoSizeRootFromContent` applies shift when > 0. |
| `packages/core/src/algorithm/layout.test.ts` | modify | 2 new unit tests. |
| `packages/core/test/fixtures/flex-wrap/wrap-reverse-*.spec.json` | create | 5 fixtures reinstated from PR #156's deferred list. |

---

## Task 1: Extend `sumChildExtent` + add `shiftChildren`

**Files:**
- Modify: `packages/core/src/algorithm/main-axis.ts`

- [ ] **Step 1: Read the current `autoSizeRootFromContent` block (lines 1080–1134).**

Confirm: `sumChildExtent` returns `number`; `autoSizeRootFromContent` writes the result directly to `root._layout.{width|height}`.

- [ ] **Step 2: Replace the helper block.**

Find the existing functions in `packages/core/src/algorithm/main-axis.ts`:

```ts
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
  return typeof sizeStyle !== 'number';
}

/** Max outer-edge of in-flow children + padEnd, clamped to root's min/max. */
function sumChildExtent(root: Node, axis: Axis): number {
  let maxEdge = 0;
  for (let i = 0; i < root.getChildCount(); i++) {
    const c = root.getChild(i)!;
    if (c.style.display === 'none') continue;
    if (c.style.positionType === 'absolute') continue;
    const edge = axis === 'row' ? c.layout.left + c.layout.width : c.layout.top + c.layout.height;
    if (edge > maxEdge) maxEdge = edge;
  }
  const padEnd = readEnd(root.style.padding, axis);
  return clampSize(root.style, axis, maxEdge + padEnd);
}
```

Replace with:

```ts
export function autoSizeRootFromContent(
  root: Node,
  available: { width?: number; height?: number } | undefined,
): void {
  for (const axis of ['row', 'column'] as const) {
    if (!axisIsBareZero(root, axis, axis === 'row' ? available?.width : available?.height)) continue;
    const { extent, shift } = childExtent(root, axis);
    const padEnd = readEnd(root.style.padding, axis);
    const total = clampSize(root.style, axis, extent + padEnd);
    if (axis === 'row') root._layout.width = total;
    else root._layout.height = total;
    if (shift > 0) shiftChildren(root, axis, shift);
  }
}

/** True iff `axis`'s size on `root` will fall through to the zero default. */
function axisIsBareZero(root: Node, axis: Axis, available: number | undefined): boolean {
  if (available !== undefined) return false;
  const sizeStyle = effectivePreferredSize(root.style, axis);
  return typeof sizeStyle !== 'number';
}

/**
 * Walk in-flow children to compute the natural cross-axis extent:
 *
 *   extent = max(child.{end edge}) - min(child.{start edge})
 *   shift  = -min(child.{start edge})  (or 0 if no child has a negative start)
 *
 * For forward-wrap and non-wrap, all child starts are ≥ 0 so `shift = 0` and
 * `extent = max edge`, matching PR #158's behavior.
 *
 * For wrap-reverse with a bare-zero auto cross, `layoutFlexFlow` flipped lines
 * about `containerCross = 0` and left children at negative cross positions.
 * `extent` recovers the true span; `shift` is the translation that brings the
 * topmost child to 0.
 */
function childExtent(root: Node, axis: Axis): { extent: number; shift: number } {
  let maxEdge = 0;
  let minStart = 0;
  for (let i = 0; i < root.getChildCount(); i++) {
    const c = root.getChild(i)!;
    if (c.style.display === 'none') continue;
    if (c.style.positionType === 'absolute') continue;
    const start = axis === 'row' ? c.layout.left : c.layout.top;
    const size = axis === 'row' ? c.layout.width : c.layout.height;
    if (start < minStart) minStart = start;
    const end = start + size;
    if (end > maxEdge) maxEdge = end;
  }
  return { extent: maxEdge - minStart, shift: -minStart };
}

/**
 * Translate every in-flow child of `root` by `shift` on `axis`. Used by
 * `autoSizeRootFromContent` to bring wrap-reverse children with negative
 * cross positions to non-negative positions after the post-step computes the
 * true content extent. Updates both the rounded and float position fields.
 *
 * Descendants don't need shifting — child positions are read relative to
 * their parent, so translating direct children moves their entire subtrees.
 *
 * Absolute children are NOT shifted: they were positioned against the root's
 * outer box during `layoutAbsoluteChildren` and stay anchored to that box.
 * (For an auto-cross root with absolutes, the absolute positions remain
 * partially wrong; the architectural Path B fix on #157 covers that.)
 */
function shiftChildren(root: Node, axis: Axis, shift: number): void {
  for (let i = 0; i < root.getChildCount(); i++) {
    const c = root.getChild(i)!;
    if (c.style.display === 'none') continue;
    if (c.style.positionType === 'absolute') continue;
    if (axis === 'row') {
      c._layout.left += shift;
      c._floatLeft += shift;
    } else {
      c._layout.top += shift;
      c._floatTop += shift;
    }
  }
}
```

Note for the engineer: the function rename from `sumChildExtent` (returns number) to `childExtent` (returns object) is intentional — the new signature is meaningfully different and the new name reflects it. The old name was a misnomer once the function started reporting two values.

- [ ] **Step 3: Typecheck.**

Run: `pnpm typecheck`
Expected: PASS. If TS complains about `Axis` not being in scope, it's imported by other functions in this file — should be fine.

- [ ] **Step 4: Run existing tests for regression check (forward-wrap and non-wrap should be unchanged).**

Run: `pnpm test packages/core/src/algorithm/layout.test.ts`
Expected: all 31 tests pass (including the 5 from PR #158's "root auto cross-axis sizing" block — they exercise the `shift = 0` path).

Run: `pnpm test packages/core/test/fixtures.test.ts`
Expected: 79 (current count on main) pass. None of the existing fixtures hit wrap-reverse with auto cross, so this is unchanged.

- [ ] **Step 5: Commit.**

```bash
git add packages/core/src/algorithm/main-axis.ts
git commit -m "feat(core): autoSize root applies shift for wrap-reverse auto-cross (#157)"
```

---

## Task 2: Unit tests for wrap-reverse shift

**Files:**
- Modify: `packages/core/src/algorithm/layout.test.ts`

- [ ] **Step 1: Append the test block to the END of `packages/core/src/algorithm/layout.test.ts`.**

```ts
describe('wrap-reverse root auto cross-axis sizing (#157)', () => {
  it('shifts in-flow children to non-negative positions and sets root cross to content sum', () => {
    const root = Node.create();
    root.setFlexDirection('row');
    root.setFlexWrap('wrap-reverse');
    root.setWidth(100);
    // 4 children of 30×30 fit 3 per line (90 ≤ 100); the 4th wraps.
    // Forward wrap would place line 0 at top=0, line 1 at top=30.
    // wrap-reverse flips: line 0 at top=container-30, line 1 at top=container-60.
    // With container_cross=0 (auto), pre-shift: line 0 at top=-30, line 1 at top=-60.
    // After shift (60): line 0 at top=30, line 1 at top=0.
    for (let i = 0; i < 4; i++) {
      const c = Node.create();
      c.setWidth(30);
      c.setHeight(30);
      root.insertChild(c, i);
    }
    root.calculateLayout();
    expect(root.getComputedLayout().height).toBe(60);
    // All in-flow children must be at non-negative positions.
    for (let i = 0; i < 4; i++) {
      const box = root.getChild(i)!.getComputedLayout();
      expect(box.top).toBeGreaterThanOrEqual(0);
    }
    // The 4th child (alone on line 1, which is line 0 after the flip) should be
    // at top=0; the first three (line 1 after flip) at top=30.
    expect(root.getChild(3)!.getComputedLayout().top).toBe(0);
    expect(root.getChild(0)!.getComputedLayout().top).toBe(30);
    expect(root.getChild(1)!.getComputedLayout().top).toBe(30);
    expect(root.getChild(2)!.getComputedLayout().top).toBe(30);
  });

  it('forward-wrap auto-cross stays unshifted (regression pin for PR #158 behavior)', () => {
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
    expect(root.getComputedLayout().height).toBe(60);
    // Forward wrap: first 3 on line 1 (top=0), 4th on line 2 (top=30).
    expect(root.getChild(0)!.getComputedLayout().top).toBe(0);
    expect(root.getChild(1)!.getComputedLayout().top).toBe(0);
    expect(root.getChild(2)!.getComputedLayout().top).toBe(0);
    expect(root.getChild(3)!.getComputedLayout().top).toBe(30);
  });
});
```

- [ ] **Step 2: Run the tests.**

Run: `pnpm test packages/core/src/algorithm/layout.test.ts`
Expected: 33 passing (31 prior + 2 new).

If the wrap-reverse test fails with children at negative positions: the post-step isn't being invoked for wrap-reverse, or `axisIsBareZero` is rejecting it incorrectly. Check `axisIsBareZero` — height was not set on root, so `style.height === 'auto'`, and no `available` was passed, so the post-step should fire.

If the wrap-reverse test fails with children at incorrect positive positions: the shift computation is off. Run a debug print of `childExtent` and verify minStart and maxEdge.

If the forward-wrap regression pin fails: PR #158's behavior was broken by Task 1's changes. Revert and investigate.

- [ ] **Step 3: Commit.**

```bash
git add packages/core/src/algorithm/layout.test.ts
git commit -m "test(core): wrap-reverse + forward-wrap unit tests (#157)"
```

---

## Task 3: Reinstate the 5 wrap-reverse fixtures via `tools/reduce-fixture.ts`

**Files:**
- Create: `packages/core/test/fixtures/flex-wrap/wrap-reverse-align-content-flex-start.spec.json`
- Create: `packages/core/test/fixtures/flex-wrap/wrap-reverse-align-content-center.spec.json`
- Create: `packages/core/test/fixtures/flex-wrap/wrap-reverse-single-line-different-size.spec.json`
- Create: `packages/core/test/fixtures/flex-wrap/wrap-reverse-align-content-stretch.spec.json`
- Create: `packages/core/test/fixtures/flex-wrap/wrap-reverse-align-content-space-around.spec.json`

These are the 5 fixtures deferred by PR #156 because of the wrap-reverse cross-sizing bug. Source HTML at `C:/Users/wangz/AppData/Local/Temp/yoga/gentest/fixtures/YGFlexWrapTest.html`.

- [ ] **Step 1: Identify each fixture's Yoga source.**

The Yoga ids → output filenames:

| Yoga id | Output filename |
|---|---|
| `wrap_reverse_row_align_content_flex_start` | `wrap-reverse-align-content-flex-start.spec.json` |
| `wrap_reverse_row_align_content_center` | `wrap-reverse-align-content-center.spec.json` |
| `wrap_reverse_row_single_line_different_size` | `wrap-reverse-single-line-different-size.spec.json` |
| `wrap_reverse_row_align_content_stretch` | `wrap-reverse-align-content-stretch.spec.json` |
| `wrap_reverse_row_align_content_space_around` | `wrap-reverse-align-content-space-around.spec.json` |

Each shape is similar: root has `width: 100px` (or 300px for the `single_line_different_size` case), `flex-direction: row`, `flex-wrap: wrap-reverse`, plus an `align-content` value. Children are 30px-wide blocks of varying heights (10/20/30/40/50).

- [ ] **Step 2: Port each fixture.**

For each Yoga id, find the matching `<div id="...">` in the Yoga source. Write a SpecNode JSON to `/tmp/in.json` matching the structure. Run the reduction tool:

```bash
pnpm tsx tools/reduce-fixture.ts /tmp/in.json --tag flex-wrap --name "flex-wrap/<output-name-without-spec-json>" --out packages/core/test/fixtures/flex-wrap/<output-name>.spec.json
```

Example for `wrap_reverse_row_align_content_flex_start` (Yoga source):
```html
<div id="wrap_reverse_row_align_content_flex_start" style="width: 100px; flex-direction: row; flex-wrap: wrap-reverse; align-content: flex-start;">
  <div style="height: 10px; width: 30px;"></div>
  <div style="height: 20px; width: 30px;"></div>
  <div style="height: 30px; width: 30px;"></div>
  <div style="height: 40px; width: 30px;"></div>
  <div style="height: 50px; width: 30px;"></div>
</div>
```

→ `/tmp/in.json`:
```json
{
  "style": { "flexDirection": "row", "flexWrap": "wrap-reverse", "width": 100, "alignContent": "flex-start" },
  "children": [
    { "style": { "width": 30, "height": 10 } },
    { "style": { "width": 30, "height": 20 } },
    { "style": { "width": 30, "height": 30 } },
    { "style": { "width": 30, "height": 40 } },
    { "style": { "width": 30, "height": 50 } }
  ]
}
```

Command:
```bash
pnpm tsx tools/reduce-fixture.ts /tmp/in.json --tag flex-wrap --name "flex-wrap/wrap-reverse-align-content-flex-start" --out packages/core/test/fixtures/flex-wrap/wrap-reverse-align-content-flex-start.spec.json
```

If reduce-fixture warns "Pilates and Yoga produced different layouts": that fixture is still divergent (the fix didn't reach all cases). Delete the emitted `.spec.json` and report the deferral.

- [ ] **Step 3: Repeat for the remaining 4 fixtures.**

Mapping reminder:
- `align-content: center` → `"alignContent": "center"`
- `align-content: stretch` → `"alignContent": "stretch"`
- `align-content: space-around` → `"alignContent": "space-around"`
- `wrap_reverse_row_single_line_different_size` uses `width: 300px` and `align-content: flex-start` — note the larger container width.

- [ ] **Step 4: Run the fixture suite.**

```bash
pnpm test packages/core/test/fixtures.test.ts
```
Expected: 79 + N passing (where N is the number actually committed; if all 5 portable, 84).

- [ ] **Step 5: Apply biome format.**

```bash
pnpm format
```

- [ ] **Step 6: Commit.**

```bash
git add packages/core/test/fixtures/flex-wrap/
git commit -m "test(core): reinstate wrap-reverse fixtures (#157)"
```

If any were deferred, note them in the commit body.

---

## Task 4: Whole-repo verification

- [ ] **Step 1: Lint.**

Run: `pnpm lint`
Expected: PASS.

- [ ] **Step 2: Test.**

Run: `pnpm test`
Expected: PASS. New count = previous + 2 (unit) + N (fixtures).

- [ ] **Step 3: Differential.**

Run: `pnpm test:differential`
Expected: PASS. Both engines apply the shift via the engine-agnostic post-step.

- [ ] **Step 4: Typecheck.**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: CI script.**

Run: `pnpm run ci`
Expected: PASS.

---

## Task 5: Push + open PR + update issue #157

- [ ] **Step 1: Push.**

```bash
git push -u origin fix/wrap-reverse-root-auto-cross
```

- [ ] **Step 2: Open PR.**

```bash
gh pr create --base main --title "fix(core): wrap-reverse root auto-cross shifts children to non-negative positions (#157)" --body "$(cat <<'EOF'
## Summary

Extends `autoSizeRootFromContent` (from PR #158) so a wrap-reverse root with bare-zero auto cross shifts its in-flow children to non-negative positions and reports a content-derived cross size. Reinstates the 5 wrap-reverse fixtures PR #156 deferred.

Matches Yoga 3.x for forward-wrap, non-wrap, AND wrap-reverse with auto cross on the root.

## Behavior

For a wrap-reverse root with auto cross, `layoutFlexFlow` flipped lines about \`containerCross = 0\` leaving children at negative cross positions. The post-step now:

1. Computes \`extent = max(child end edge) - min(child start edge)\` instead of just the max.
2. Sets root cross = \`clampSize(extent + padEnd)\`.
3. If any child's start was negative, shifts all in-flow children by \`-min(start)\` so the topmost lands at 0.

The shift is uniform across siblings (preserves their relative ordering). Absolute children are NOT shifted — they were positioned against the unshifted container during \`layoutAbsoluteChildren\` and stay anchored to that box. The absolute-child fix-up requires the architectural Path B work on issue #157.

## Changes

- \`packages/core/src/algorithm/main-axis.ts\` — \`sumChildExtent\` renamed to \`childExtent\` and returns \`{ extent, shift }\`; new private \`shiftChildren\`; \`autoSizeRootFromContent\` applies the shift when > 0.
- \`packages/core/src/algorithm/layout.test.ts\` — 2 unit tests (wrap-reverse shift + forward-wrap regression pin).
- \`packages/core/test/fixtures/flex-wrap/wrap-reverse-*.spec.json\` — 5 reinstated fixtures.

## Test plan

- [x] \`pnpm test\`
- [x] \`pnpm test:differential\`
- [x] \`pnpm typecheck\`
- [x] \`pnpm lint\`
- [x] \`pnpm run ci\`

Advances #157. Remaining open: inner-container auto-cross (architectural Path B) + absolute-child fix-up for auto-cross roots.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Update issue #157.**

```bash
gh issue comment 157 --body "wrap-reverse path closed by PR #<this PR number>. Remaining open: (1) inner-container auto-cross via \`naturalCrossSize\` (Path B — architectural), (2) absolute-child fix-up for auto-cross roots (depends on a re-run of \`layoutAbsoluteChildren\` after the post-step shift)."
```

- [ ] **Step 4: Return the PR URL.**

---

## Self-review notes

**Spec coverage:**
- Extended `sumChildExtent` (now `childExtent`) → Task 1
- New `shiftChildren` → Task 1
- `autoSizeRootFromContent` integration → Task 1
- 2 unit tests (shift + regression pin) → Task 2
- 5 fixture reinstatement → Task 3
- Engine-agnostic verification → Task 4
- Issue #157 update → Task 5

**Memory pointers:**
- `feedback_pilates_typecheck_command` — `pnpm typecheck`.
- `feedback_pilates_branch_pr_workflow` — branch + PR.
- `feedback_pnpm_script_name_collisions` — `pnpm run ci` not `pnpm ci`.
- The Actions budget is now resolved, so remote CI should also run.

**Risks called out in the spec:**
- Absolute children left at unshifted positions (documented; out of scope).
- `finishMoved` re-round picks up shifted positions correctly via the existing `roundLayoutFrom(this.root, 0, 0, 0, 0)` from PR #158.
