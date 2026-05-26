# Wrap-Reverse Per-Line Cross Alignment — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When parent has `flexWrap: 'wrap-reverse'`, in-flow items anchor at their line's cross-END by default (Yoga 3.x semantics). Closes issue #159; reinstates 5 wrap-reverse fixtures deferred by PRs #156/#160.

**Architecture:** In both engines, flip the effective per-item cross alignment (`flex-start ↔ flex-end`) when the parent is wrap-reverse. Apply the flip AFTER `align-self` resolution. For stretch with explicit cross, the size stays stretch-like (clamp explicit) but the position uses flex-end formula.

**Tech Stack:** TypeScript, vitest, pnpm.

**Spec:** `docs/superpowers/specs/2026-05-26-wrap-reverse-cross-alignment-design.md`
**Branch:** `fix/wrap-reverse-cross-alignment` (already created from `41c5897`; spec committed at `be25fe4`).
**Closes:** #159.

---

## File Structure

| Path | Change | Responsibility |
|---|---|---|
| `packages/core/src/algorithm/main-axis.ts` | modify | `crossAlignItemsInLine` accepts `wrap`; flips align; stretch+explicit uses flex-end position when wrap-reverse. Call site at line 320 passes `node.style.flexWrap`. |
| `packages/core/src/algorithm/spineless/flex-grammar.ts` | modify | Apply the same flip in the cross-position emission (no-wrap path and wrap path). |
| `packages/core/src/algorithm/layout.test.ts` | modify | 4 unit tests. |
| `packages/core/test/fixtures/flex-wrap/wrap-reverse-*.spec.json` | create | 5 reinstated fixtures. |

---

## Task 1: Classic engine flip in `crossAlignItemsInLine`

**Files:**
- Modify: `packages/core/src/algorithm/main-axis.ts`

- [ ] **Step 1: Read the current state of `crossAlignItemsInLine` (line 825) and its caller (line 320).**

```bash
grep -n "crossAlignItemsInLine\|function crossAlignItemsInLine" packages/core/src/algorithm/main-axis.ts
```

Confirm the function takes `(line: FlexLine, alignItems: Align)` today.

- [ ] **Step 2: Extend the function signature and add the flip.**

In `packages/core/src/algorithm/main-axis.ts`, find:

```ts
function crossAlignItemsInLine(line: FlexLine, alignItems: Align): void {
  for (const item of line.items) {
    const align = effectiveAlign(item.node.style.alignSelf, alignItems);
```

Replace with:

```ts
function crossAlignItemsInLine(line: FlexLine, alignItems: Align, wrap: FlexWrap): void {
  const reverseCross = wrap === 'wrap-reverse';
  for (const item of line.items) {
    let align = effectiveAlign(item.node.style.alignSelf, alignItems);
    // wrap-reverse flips per-item cross alignment within each line:
    // flex-start ↔ flex-end. The line-stack flip is handled separately
    // by reverseLineStack; this is the per-line item flip. center and
    // stretch (with auto cross) are unchanged. stretch with explicit
    // cross is handled inside the stretch branch below — see comment.
    if (reverseCross) {
      if (align === 'flex-start') align = 'flex-end';
      else if (align === 'flex-end') align = 'flex-start';
    }
```

(`let align` instead of `const`, plus the conditional flip.)

- [ ] **Step 3: Update the stretch branch to flip position for explicit cross under wrap-reverse.**

Find inside `crossAlignItemsInLine`:

```ts
    if (align === 'stretch') {
      // aspectRatio-derived cross wins over stretch when the cross is auto
      // — matches CSS aspect-ratio behavior and Yoga's HasDefiniteCrossSize
      // check (an aspect-ratio derivation is treated as definite).
      const explicit = effectivePreferredSize(item.node.style, cross);
      if (typeof explicit === 'number') {
        item.finalCross = clampSize(item.node.style, cross, explicit);
      } else {
        item.finalCross = clampSize(item.node.style, cross, Math.max(0, innerLine));
      }
      item.crossPos = item.marginCrossStart;
      continue;
    }
```

Replace with:

```ts
    if (align === 'stretch') {
      // aspectRatio-derived cross wins over stretch when the cross is auto
      // — matches CSS aspect-ratio behavior and Yoga's HasDefiniteCrossSize
      // check (an aspect-ratio derivation is treated as definite).
      const explicit = effectivePreferredSize(item.node.style, cross);
      if (typeof explicit === 'number') {
        item.finalCross = clampSize(item.node.style, cross, explicit);
        // wrap-reverse + stretch + explicit cross: stretch fills nothing
        // (explicit wins), so position behaves like flex-end on the line.
        item.crossPos = reverseCross
          ? line.crossSize - item.finalCross - item.marginCrossEnd
          : item.marginCrossStart;
      } else {
        item.finalCross = clampSize(item.node.style, cross, Math.max(0, innerLine));
        // stretch + auto cross: child fills the line; position is moot.
        item.crossPos = item.marginCrossStart;
      }
      continue;
    }
```

- [ ] **Step 4: Update the caller at line 320.**

Find:

```ts
  for (const line of lines) {
    positionItemsInLine(line, node.style.justifyContent, innerMain, gapMain);
    crossAlignItemsInLine(line, node.style.alignItems);
  }
```

Replace with:

```ts
  for (const line of lines) {
    positionItemsInLine(line, node.style.justifyContent, innerMain, gapMain);
    crossAlignItemsInLine(line, node.style.alignItems, node.style.flexWrap);
  }
```

- [ ] **Step 5: Confirm `FlexWrap` is in scope.**

`FlexWrap` is exported from `../style.js`. Check that `main-axis.ts` already imports it; if not, add to the existing type imports at the top.

Run:
```
grep -n "^import.*FlexWrap" packages/core/src/algorithm/main-axis.ts
```

If no match, find the existing style-type imports and add `FlexWrap` to the list.

- [ ] **Step 6: Typecheck.**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 7: Run existing tests for regression.**

Run: `pnpm test packages/core/src/algorithm/layout.test.ts`
Expected: 33 passing (existing tests; Task 2 adds 4 more).

Run: `pnpm test packages/core/test/fixtures.test.ts`
Expected: same count as before this PR. The existing fixtures don't use wrap-reverse with variable-cross children, so should be unchanged.

- [ ] **Step 8: Commit.**

```bash
git add packages/core/src/algorithm/main-axis.ts
git commit -m "fix(core): classic engine flips cross-align in wrap-reverse lines (#159)"
```

---

## Task 2: Unit tests for the flip

**Files:**
- Modify: `packages/core/src/algorithm/layout.test.ts`

- [ ] **Step 1: Append a new describe block to the end of `packages/core/src/algorithm/layout.test.ts`.**

```ts
describe('wrap-reverse per-line cross alignment (#159)', () => {
  it('default alignItems anchors children to line bottom (flex-start flipped to flex-end)', () => {
    // Single-line wrap-reverse: width=300 fits 5*30=150 on one line.
    // Children have heights 10/20/30/40/50; line cross = 50 (max).
    // Yoga: each shares the BOTTOM edge of the 50-px line:
    //   top = lineCross - childHeight
    //   = 40 / 30 / 20 / 10 / 0
    // (Classic alignItems defaults to 'stretch'; but explicit child height
    // bypasses the stretch resize, falls through to position step which
    // applies the wrap-reverse flip → flex-end.)
    const root = Node.create();
    root.setFlexDirection('row');
    root.setFlexWrap('wrap-reverse');
    root.setWidth(300);
    const heights = [10, 20, 30, 40, 50];
    for (let i = 0; i < heights.length; i++) {
      const c = Node.create();
      c.setWidth(30);
      c.setHeight(heights[i]!);
      root.insertChild(c, i);
    }
    root.calculateLayout();
    // The single line has cross=50; all children share bottom edge at 50.
    expect(root.getChild(0)!.getComputedLayout().top).toBe(40); // 50 - 10
    expect(root.getChild(1)!.getComputedLayout().top).toBe(30);
    expect(root.getChild(2)!.getComputedLayout().top).toBe(20);
    expect(root.getChild(3)!.getComputedLayout().top).toBe(10);
    expect(root.getChild(4)!.getComputedLayout().top).toBe(0);
  });

  it('explicit alignItems: flex-end on wrap-reverse anchors children to line top', () => {
    // Same shape, but alignItems: flex-end → flipped to flex-start by wrap-reverse.
    // Children share the TOP of the line at top=0.
    const root = Node.create();
    root.setFlexDirection('row');
    root.setFlexWrap('wrap-reverse');
    root.setAlignItems('flex-end');
    root.setWidth(300);
    const heights = [10, 20, 30, 40, 50];
    for (let i = 0; i < heights.length; i++) {
      const c = Node.create();
      c.setWidth(30);
      c.setHeight(heights[i]!);
      root.insertChild(c, i);
    }
    root.calculateLayout();
    for (let i = 0; i < 5; i++) {
      expect(root.getChild(i)!.getComputedLayout().top).toBe(0);
    }
  });

  it('alignItems: center on wrap-reverse stays center', () => {
    const root = Node.create();
    root.setFlexDirection('row');
    root.setFlexWrap('wrap-reverse');
    root.setAlignItems('center');
    root.setWidth(300);
    const heights = [10, 20, 30, 40, 50];
    for (let i = 0; i < heights.length; i++) {
      const c = Node.create();
      c.setWidth(30);
      c.setHeight(heights[i]!);
      root.insertChild(c, i);
    }
    root.calculateLayout();
    // line cross=50, centered: top = (50 - height) / 2
    expect(root.getChild(0)!.getComputedLayout().top).toBe(20); // (50-10)/2
    expect(root.getChild(2)!.getComputedLayout().top).toBe(10); // (50-30)/2
    expect(root.getChild(4)!.getComputedLayout().top).toBe(0); // (50-50)/2
  });

  it('wrap-reverse + auto-height children + stretch fills the line', () => {
    // Children have NO explicit height → stretch fills line.
    // Single line: with no explicit heights, each line cross = max content = 0
    // (since children are empty). So line cross = 0 and all stretched children
    // have height 0. Add an explicit line height by giving one child a height.
    const root = Node.create();
    root.setFlexDirection('row');
    root.setFlexWrap('wrap-reverse');
    root.setWidth(100);
    // One sized child sets the line cross to 30; two auto children stretch to 30.
    const sized = Node.create();
    sized.setWidth(30);
    sized.setHeight(30);
    root.insertChild(sized, 0);
    const auto1 = Node.create();
    auto1.setWidth(30);
    root.insertChild(auto1, 1);
    const auto2 = Node.create();
    auto2.setWidth(30);
    root.insertChild(auto2, 2);
    root.calculateLayout();
    // All three share line=30. Sized child: top=0 (height=30 fills the line —
    // flex-end position formula: 30 - 30 - 0 = 0). Auto children: stretched to 30,
    // top=0 (margin=0). All children have height 30.
    expect(root.getChild(0)!.getComputedLayout().height).toBe(30);
    expect(root.getChild(1)!.getComputedLayout().height).toBe(30);
    expect(root.getChild(2)!.getComputedLayout().height).toBe(30);
    expect(root.getChild(0)!.getComputedLayout().top).toBe(0);
    expect(root.getChild(1)!.getComputedLayout().top).toBe(0);
    expect(root.getChild(2)!.getComputedLayout().top).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests.**

Run: `pnpm test packages/core/src/algorithm/layout.test.ts`
Expected: 37 passing (33 prior + 4 new).

If a wrap-reverse test fails: debug by running a single test and inspecting the actual boxes. The most likely cause is a mis-mapping of `alignItems` default (Pilates default is `stretch`, not `flex-start`); the test commentary already addresses that path.

- [ ] **Step 3: Commit.**

```bash
git add packages/core/src/algorithm/layout.test.ts
git commit -m "test(core): wrap-reverse cross-alignment unit tests (#159)"
```

---

## Task 3: Spineless engine flip in cross-position emission

**Files:**
- Modify: `packages/core/src/algorithm/spineless/flex-grammar.ts`

The spineless grammar has two emission paths for `crossPosField`:
- **No-wrap path** (around line 1370): branches on `align` (flex-end, center, default).
- **Wrap path**: emits a per-line packer; needs investigation to find the equivalent flip point.

This task does both paths.

- [ ] **Step 1: Locate the align computation (around line 783-788).**

Run:
```bash
grep -n "const align: Align\|align === 'flex-end'\|align === 'center'\|align === 'stretch'" packages/core/src/algorithm/spineless/flex-grammar.ts | head -10
```

Confirm `align` is computed once at the top of the visit function, then used in multiple emission branches.

- [ ] **Step 2: Compute `posAlign` after `align` is computed.**

Find the existing block:

```ts
    const justify: Justify = parent === null ? 'flex-start' : parent.style.justifyContent;
    const align: Align =
      parent === null
        ? 'auto'
        : node.style.alignSelf === 'auto'
          ? parent.style.alignItems
          : node.style.alignSelf;
```

Add immediately after:

```ts
    // wrap-reverse flips per-item cross alignment within each line. The
    // SIZE branches below still use `align` (stretch with explicit cross
    // is a no-resize size branch), but the POSITION branches use `posAlign`
    // which has the flex-start ↔ flex-end flip applied. Mirrors the
    // imperative `crossAlignItemsInLine` (#159).
    let posAlign: Align = align;
    if (parent !== null && parent.style.flexWrap === 'wrap-reverse') {
      if (posAlign === 'flex-start') posAlign = 'flex-end';
      else if (posAlign === 'flex-end') posAlign = 'flex-start';
      else if (posAlign === 'stretch' && !crossIsContentAuto) posAlign = 'flex-end';
    }
```

The `crossIsContentAuto` reference will fail if it's defined LATER in the function. If so, move the `posAlign` computation to AFTER `crossIsContentAuto` is computed (around line 802-803). The order is: `align` (line 783) → `crossKey` (line 801) → `crossIsContentAuto` (line 802) → THEN insert `posAlign` block.

- [ ] **Step 3: Use `posAlign` in the cross-position emission (line 1370+).**

Replace the three `align === ...` checks in the position emission with `posAlign === ...`:

Find:

```ts
    if (parent === null || align === 'flex-end') {
      if (parent !== null && align === 'flex-end') {
```

Replace with:

```ts
    if (parent === null || posAlign === 'flex-end') {
      if (parent !== null && posAlign === 'flex-end') {
```

Find:

```ts
    } else if (align === 'center') {
```

Replace with:

```ts
    } else if (posAlign === 'center') {
```

The "else" (default) branch (line 1427) handles flex-start, stretch+explicit, and unsupported values — all of which share the flex-start-anchor formula. With `posAlign` being flex-end for wrap-reverse + stretch+explicit, that case now correctly routes to the flex-end branch instead. 

- [ ] **Step 4: Check the wrap path for an equivalent flip site.**

The spineless engine has a separate per-line packer for `flexWrap === 'wrap'` (and likely `wrap-reverse`). Find it:

```bash
grep -n "emitWrapped\|wrapPacker\|flexWrap === 'wrap'" packages/core/src/algorithm/spineless/flex-grammar.ts | head -10
```

Look for an emission point that decides where each item lands within a wrapped line on the cross axis. If it uses `align` or `s.node.style.alignSelf` directly to pick a formula, apply the same flip there.

If the wrap path uses a different mechanism (e.g., delegates to a runtime helper that mirrors the imperative `crossAlignItemsInLine`), no change is needed at the grammar level — the runtime helper will inherit the imperative's fix from Task 1.

Document what you find. If the wrap path needs a change, apply the same `posAlign` flip pattern.

- [ ] **Step 5: Typecheck.**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Run the differential suite. This is the critical gate — classic and spineless must agree on the wrap-reverse cases.**

Run: `pnpm test:differential 2>&1 | tail -10`
Expected: PASS (current count + any newly-fixed agreement).

Run: `pnpm test 2>&1 | tail -5`
Expected: PASS. The 4 unit tests from Task 2 still pass.

If differential FAILS: classic and spineless disagree on a wrap-reverse case. Most likely cause: the wrap path needs the flip too. Investigate the wrap emission point.

- [ ] **Step 7: Commit.**

```bash
git add packages/core/src/algorithm/spineless/flex-grammar.ts
git commit -m "fix(core): spineless engine flips cross-align in wrap-reverse lines (#159)"
```

---

## Task 4: Reinstate 5 wrap-reverse fixtures

**Files:**
- Create: `packages/core/test/fixtures/flex-wrap/wrap-reverse-align-content-flex-start.spec.json`
- Create: `packages/core/test/fixtures/flex-wrap/wrap-reverse-align-content-center.spec.json`
- Create: `packages/core/test/fixtures/flex-wrap/wrap-reverse-single-line-different-size.spec.json`
- Create: `packages/core/test/fixtures/flex-wrap/wrap-reverse-align-content-stretch.spec.json`
- Create: `packages/core/test/fixtures/flex-wrap/wrap-reverse-align-content-space-around.spec.json`

Same fixtures as PR #160's Task 3 attempted; now should port cleanly since both root sizing AND per-line alignment are fixed.

- [ ] **Step 1: Port each fixture via `tools/reduce-fixture.ts`.**

Source HTML: `C:/Users/wangz/AppData/Local/Temp/yoga/gentest/fixtures/YGFlexWrapTest.html`. For each Yoga id, write a SpecNode JSON to `/tmp/in.json` and run:

```bash
pnpm tsx tools/reduce-fixture.ts /tmp/in.json --tag flex-wrap --name "flex-wrap/<output-name-without-spec-json>" --out packages/core/test/fixtures/flex-wrap/<output-name>.spec.json
```

Mapping:

| Yoga id | Output filename |
|---|---|
| `wrap_reverse_row_align_content_flex_start` | `wrap-reverse-align-content-flex-start.spec.json` |
| `wrap_reverse_row_align_content_center` | `wrap-reverse-align-content-center.spec.json` |
| `wrap_reverse_row_single_line_different_size` | `wrap-reverse-single-line-different-size.spec.json` |
| `wrap_reverse_row_align_content_stretch` | `wrap-reverse-align-content-stretch.spec.json` |
| `wrap_reverse_row_align_content_space_around` | `wrap-reverse-align-content-space-around.spec.json` |

Example `/tmp/in.json` for `wrap_reverse_row_align_content_flex_start`:
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

The `single_line_different_size` fixture uses `width: 300` (not 100); read the Yoga HTML to confirm.

If `reduce-fixture` reports a divergence for any fixture: defer it. We may have missed an emission point.

- [ ] **Step 2: Run the fixture suite.**

Run: `pnpm test packages/core/test/fixtures.test.ts`
Expected: current count (74) + N (ported count) passing.

- [ ] **Step 3: `pnpm format`.**

- [ ] **Step 4: Commit.**

```bash
git add packages/core/test/fixtures/flex-wrap/
git commit -m "test(core): reinstate wrap-reverse fixtures (#159)"
```

---

## Task 5: Whole-repo verification

- [ ] **Step 1: Lint.**

Run: `pnpm lint`
Expected: PASS.

- [ ] **Step 2: Test.**

Run: `pnpm test`
Expected: PASS.

- [ ] **Step 3: Differential.**

Run: `pnpm test:differential`
Expected: PASS.

- [ ] **Step 4: Typecheck.**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: CI script.**

Run: `pnpm run ci`
Expected: PASS.

---

## Task 6: Push + open PR + close issue #159

- [ ] **Step 1: Push.**

```bash
git push -u origin fix/wrap-reverse-cross-alignment
```

- [ ] **Step 2: Open PR with `Closes #159`.**

```bash
gh pr create --base main --title "fix(core): flip cross alignment in wrap-reverse lines (closes #159)" --body "$(cat <<'EOF'
## Summary

When parent has \`flexWrap: 'wrap-reverse'\`, items inside each line anchor to the line's cross-END by default (Yoga 3.x semantics, matching the CSS reversed-axis flex model). Pilates today anchors at cross-START regardless of wrap direction, producing different per-child top positions for variable-height children. This PR flips the per-item alignment in both engines.

Closes #159. Closes the 5 wrap-reverse fixtures still deferred from PRs #156 and #160.

## Behavior

The flip applies to the effective per-item alignment (after \`align-self\` resolution):

| Original align | Wrap-reverse |
|---|---|
| \`flex-start\` ↔ \`flex-end\` | swapped |
| \`center\` | unchanged |
| \`stretch\` (auto cross) | unchanged (fills line) |
| \`stretch\` (explicit cross) | anchored at cross-end |

Line-stack flipping was already handled by \`reverseLineStack\`; this PR fills in the WITHIN-line per-item flip.

## Changes

- \`packages/core/src/algorithm/main-axis.ts\` — \`crossAlignItemsInLine\` gains \`wrap\` parameter; applies the flip after \`effectiveAlign\`.
- \`packages/core/src/algorithm/spineless/flex-grammar.ts\` — computes \`posAlign\` (flipped) for position emission; size emission still uses \`align\`.
- \`packages/core/src/algorithm/layout.test.ts\` — 4 unit tests.
- \`packages/core/test/fixtures/flex-wrap/wrap-reverse-*.spec.json\` — 5 reinstated fixtures.

## Test plan

- [x] \`pnpm test\`
- [x] \`pnpm test:differential\`
- [x] \`pnpm typecheck\`
- [x] \`pnpm lint\`
- [x] \`pnpm run ci\`

Advances #157 (closes #159).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Update issue #157 with remaining scope.**

```bash
gh issue comment 157 --body "wrap-reverse per-line cross alignment closed by PR #<this PR number>. Remaining open: (1) inner-container auto-cross via naturalCrossSize (Path B — architectural), (2) absolute-child fix-up for auto-cross roots."
```

- [ ] **Step 4: Return the PR URL.**

---

## Self-review notes

**Spec coverage:**
- Classic engine `crossAlignItemsInLine` flip → Task 1
- Spineless `posAlign` flip → Task 3
- 4 unit tests → Task 2
- 5 fixture reinstatement → Task 4
- DoD all-green → Task 5
- Close #159 + update #157 → Task 6

**Type consistency:** `wrap: FlexWrap` and `posAlign: Align` named consistently across tasks.

**Memory pointers:**
- `feedback_pilates_typecheck_command` — `pnpm typecheck`.
- `feedback_pilates_branch_pr_workflow` — branch + PR.
- `feedback_pnpm_script_name_collisions` — `pnpm run ci`.
