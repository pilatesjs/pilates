# Root Margin Offset — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Set `root._layout.left = marginLeft` and `root._layout.top = marginTop` in both engines. Closes issue #163; reinstates 4 deferred fixtures from PR #162.

**Architecture:** Classic engine writes margin values into root's `_layout` in `calculateLayoutImpl`'s cold path. Spineless engine emits margin-input-driven rules for root's `mainPosField` / `crossPosField` (which resolve to root's `left` / `top` fields since `parentDirection === null` falls through to row-default mapping).

**Tech Stack:** TypeScript, vitest, pnpm.

**Spec:** `docs/superpowers/specs/2026-05-26-root-margin-offset-design.md`
**Branch:** `fix/root-margin-offset` (already created from `3b3e04e`; spec committed at `be99dfd`).
**Closes:** #163.

---

## File Structure

| Path | Change | Responsibility |
|---|---|---|
| `packages/core/src/algorithm/index.ts` | modify | Root `_layout.left/top` init writes margin values. |
| `packages/core/src/algorithm/spineless/flex-grammar.ts` | modify | Root `mainPosField` (line 1232) and `crossPosField` (line 1410) emit margin-input rules. |
| `packages/core/src/algorithm/layout.test.ts` | modify | 1 new unit test. |
| `packages/core/test/fixtures/justify-content/*.spec.json` | create | 4 reinstated fixtures from PR #162's deferral list. |

---

## Task 1: Classic engine — write margin to root `_layout`

**Files:**
- Modify: `packages/core/src/algorithm/index.ts`

- [ ] **Step 1: Confirm the existing init block.**

Run:
```bash
grep -n "root._layout.left = 0\|root._layout.top = 0\|root._floatLeft\|root._floatTop" packages/core/src/algorithm/index.ts | head -5
```
Expected: lines 223-226 set all four to 0 in the cold path.

- [ ] **Step 2: Replace the init block.**

In `packages/core/src/algorithm/index.ts`, find:

```ts
  // Cold path
  root._layout.left = 0;
  root._layout.top = 0;
  root._floatLeft = 0;
  root._floatTop = 0;
  root._layout.width = resolveRootAxisSize(root, 'row', availableWidth);
  root._layout.height = resolveRootAxisSize(root, 'column', availableHeight);
```

Replace with:

```ts
  // Cold path. The root's own margins offset it from the implicit world
  // origin (Yoga 3.x semantics; matches issue #163). For non-root nodes
  // the flex pipeline handles margins via step 8; the root has no parent
  // pipeline, so the offset is applied here directly. Edge.Left and
  // Edge.Top are always the relevant edges for the root — its own
  // flex-direction doesn't change which margin pushes the world origin.
  const rootMarginLeft = root.style.margin[Edge.Left];
  const rootMarginTop = root.style.margin[Edge.Top];
  root._layout.left = rootMarginLeft;
  root._layout.top = rootMarginTop;
  root._floatLeft = rootMarginLeft;
  root._floatTop = rootMarginTop;
  root._layout.width = resolveRootAxisSize(root, 'row', availableWidth);
  root._layout.height = resolveRootAxisSize(root, 'column', availableHeight);
```

- [ ] **Step 3: Ensure `Edge` is imported.**

Run:
```bash
grep -n "^import.*Edge" packages/core/src/algorithm/index.ts
```

If no match (or only a `type` import), add a value import from `../edge.js`:

```ts
import { Edge } from '../edge.js';
```

Find the existing imports near the top of `index.ts` and add `Edge` in alphabetical order alongside them.

- [ ] **Step 4: Typecheck.**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Run existing tests for regression.**

Run: `pnpm test packages/core/src/algorithm/`
Expected: PASS. No existing tests should rely on root being at (0,0) when margin is set, but watch the output. If a test fails because it asserted `root.left === 0` with a margin, the assertion was wrong — update it to match Yoga.

Run: `pnpm test packages/core/test/fixtures.test.ts`
Expected: PASS. No existing fixture sets margin on the root; existing roots have margin=0 (default), so offset is 0 and behavior is unchanged.

- [ ] **Step 6: Commit.**

```bash
git add packages/core/src/algorithm/index.ts
git commit -m "fix(core): classic engine offsets root by margin (#163)"
```

---

## Task 2: Spineless engine — emit margin-driven root pos rules

**Files:**
- Modify: `packages/core/src/algorithm/spineless/flex-grammar.ts`

The grammar has TWO root-pos emission points where `compute: () => 0` lives. Both need the margin-input fix.

- [ ] **Step 1: Confirm the two emission points.**

Run:
```bash
grep -n "compute: () => 0" packages/core/src/algorithm/spineless/flex-grammar.ts | head -5
```
Expected: lines 427 (unrelated — some other root-only emission, leave alone), 1234 (root `mainPosField`), 1412 (root `crossPosField`).

If the line numbers drift, look for the patterns:
- `mainPosField`: inside `if (parent === null)` near `// Root is parent-less — anchor at 0.`
- `crossPosField`: inside `else { ... compute: () => 0 ... }` near `// Root: no parent, no alignment to apply — anchor at 0.`

The line 427 site is `crossSizeField` for an `'auto'` root — that one is unrelated; do NOT touch it.

- [ ] **Step 2: Replace the root `mainPosField` emission.**

Find:

```ts
      if (parent === null) {
        // Root is parent-less — anchor at 0.
        grammar.set(mainPosField, {
          deps: [],
          compute: () => 0,
        } satisfies FieldRule<number>);
      } else if (justify === 'flex-start') {
```

Replace with:

```ts
      if (parent === null) {
        // Root is parent-less. Its own margin offsets the root from the
        // implicit world origin (#163). The Spineless mainPosField for
        // root resolves to its `left` Field (parentDirection === null
        // falls through to row-default mapping), so Edge.Left is the
        // correct margin edge regardless of the root's own
        // flex-direction. The same shape applies to crossPosField below.
        const rootMarginLeftF = marginInput(node, Edge.Left);
        grammar.set(mainPosField, {
          deps: [rootMarginLeftF as Field<unknown>],
          compute: (read) => read(rootMarginLeftF),
        } satisfies FieldRule<number>);
      } else if (justify === 'flex-start') {
```

- [ ] **Step 3: Replace the root `crossPosField` emission.**

Find:

```ts
      } else {
        // Root: no parent, no alignment to apply — anchor at 0.
        grammar.set(crossPosField, {
          deps: [],
          compute: () => 0,
        } satisfies FieldRule<number>);
      }
    } else if (posAlign === 'center') {
```

Replace with:

```ts
      } else {
        // Root: no parent, no alignment to apply — anchor at margin.top
        // (#163). Mirror of the mainPosField margin emission above.
        const rootMarginTopF = marginInput(node, Edge.Top);
        grammar.set(crossPosField, {
          deps: [rootMarginTopF as Field<unknown>],
          compute: (read) => read(rootMarginTopF),
        } satisfies FieldRule<number>);
      }
    } else if (posAlign === 'center') {
```

- [ ] **Step 4: Ensure `Edge` is imported in flex-grammar.ts.**

Run:
```bash
grep -n "^import.*Edge" packages/core/src/algorithm/spineless/flex-grammar.ts | head -3
```

If `Edge` (value, not type-only) isn't imported, add to the existing imports. The file imports many things from `'../../edge.js'` or `'../edge.js'` — find the right relative path by looking at how other files in `spineless/` import Edge:

```bash
grep "from.*edge.js" packages/core/src/algorithm/spineless/*.ts | head -3
```

- [ ] **Step 5: Typecheck.**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Run differential.**

Run: `pnpm test:differential 2>&1 | tail -5`
Expected: PASS. Both engines now apply the same margin offset to root.

- [ ] **Step 7: Run full test suite.**

Run: `pnpm test 2>&1 | tail -5`
Expected: PASS.

- [ ] **Step 8: Commit.**

```bash
git add packages/core/src/algorithm/spineless/flex-grammar.ts
git commit -m "fix(core): spineless engine offsets root by margin (#163)"
```

---

## Task 3: Unit test for the offset

**Files:**
- Modify: `packages/core/src/algorithm/layout.test.ts`

- [ ] **Step 1: Append the test to the END of `packages/core/src/algorithm/layout.test.ts`.**

```ts
describe('root margin offset (#163)', () => {
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
    // Child position is relative to root's corner — unchanged by root margin.
    expect(kid.getComputedLayout()).toMatchObject({ left: 0, top: 0, width: 20, height: 20 });
  });
});
```

- [ ] **Step 2: Run the test.**

Run: `pnpm test packages/core/src/algorithm/layout.test.ts`
Expected: PASS (38 tests = 37 prior + 1 new).

- [ ] **Step 3: Commit.**

```bash
git add packages/core/src/algorithm/layout.test.ts
git commit -m "test(core): root margin offset unit test (#163)"
```

---

## Task 4: Reinstate 4 deferred margin fixtures

**Files:**
- Create: `packages/core/test/fixtures/justify-content/row-min-width-and-margin.spec.json`
- Create: `packages/core/test/fixtures/justify-content/row-max-width-and-margin.spec.json`
- Create: `packages/core/test/fixtures/justify-content/column-min-height-and-margin.spec.json`
- Create: `packages/core/test/fixtures/justify-content/column-max-height-and-margin.spec.json`

These are the fixtures PR #162 deferred specifically due to this bug.

- [ ] **Step 1: Port each via `tools/reduce-fixture.ts`.**

Source HTML: `C:/Users/wangz/AppData/Local/Temp/yoga/gentest/fixtures/YGJustifyContentTest.html`. For each Yoga id, write a SpecNode JSON to `/tmp/in.json` and run:

```bash
pnpm tsx tools/reduce-fixture.ts /tmp/in.json --tag justify-content --name "justify-content/<output-name-without-spec-json>" --out packages/core/test/fixtures/justify-content/<output-name>.spec.json
```

Mapping:
- `justify_content_row_min_width_and_margin` → `row-min-width-and-margin.spec.json`
- `justify_content_row_max_width_and_margin` → `row-max-width-and-margin.spec.json`
- `justify_content_column_min_height_and_margin` → `column-min-height-and-margin.spec.json`
- `justify_content_column_max_height_and_margin` → `column-max-height-and-margin.spec.json`

If the reduce-fixture warning appears for any fixture, the fix didn't reach it — investigate and report.

- [ ] **Step 2: Run the fixture suite.**

Run: `pnpm test packages/core/test/fixtures.test.ts`
Expected: 92 (current) + 4 = 96 passing.

- [ ] **Step 3: Format and commit.**

```bash
pnpm format
git add packages/core/test/fixtures/justify-content/
git commit -m "test(core): reinstate root-margin justify-content fixtures (#163)"
```

---

## Task 5: Whole-repo verification

- [ ] **Step 1: Lint.**

Run: `pnpm lint`
Expected: PASS.

- [ ] **Step 2: Full test.**

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

## Task 6: Push + open PR + close #163

- [ ] **Step 1: Push.**

```bash
git push -u origin fix/root-margin-offset
```

- [ ] **Step 2: Open PR with `Closes #163`.**

```bash
gh pr create --base main --title "fix(core): root layout offsets by own margin (closes #163)" --body "$(cat <<'EOF'
## Summary

Sets \`root._layout.left = marginLeft\`, \`root._layout.top = marginTop\` for top-level roots (Yoga 3.x semantics). Pilates today leaves root at \`(0, 0)\` regardless of margin; this PR offsets it. Closes the 4 fixtures PR #162 deferred for this bug.

Closes #163.

## Behavior

- Root with no margin: behavior unchanged (left = top = 0).
- Root with marginLeft = N: \`root.layout.left = N\`.
- Root with marginTop = N: \`root.layout.top = N\`.
- Children's positions are relative to root's corner — \`getComputedLayout()\` on children unchanged.

## Changes

- \`packages/core/src/algorithm/index.ts\` — cold-path root \`_layout\` init reads \`margin[Edge.Left]\` / \`[Edge.Top]\`.
- \`packages/core/src/algorithm/spineless/flex-grammar.ts\` — root \`mainPosField\` / \`crossPosField\` rules depend on \`marginInput(node, Edge.Left/Top)\` instead of returning constant 0.
- \`packages/core/src/algorithm/layout.test.ts\` — 1 new unit test.
- \`packages/core/test/fixtures/justify-content/\` — 4 reinstated fixtures.

## Test plan

- [x] \`pnpm test\`
- [x] \`pnpm test:differential\`
- [x] \`pnpm typecheck\`
- [x] \`pnpm lint\`
- [x] \`pnpm run ci\`

Closes #163.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Return the PR URL.**

---

## Self-review notes

**Spec coverage:**
- Classic engine fix → Task 1
- Spineless engine fix → Task 2
- Unit test → Task 3
- 4 fixture reinstatement → Task 4
- DoD all-green → Task 5
- Close #163 → Task 6

**Memory pointers:**
- `feedback_pilates_typecheck_command` — `pnpm typecheck`.
- `feedback_pilates_branch_pr_workflow` — branch + PR.
- `feedback_pnpm_script_name_collisions` — `pnpm run ci`.
