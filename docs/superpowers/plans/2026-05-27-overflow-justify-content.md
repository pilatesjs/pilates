# Overflow `justifyContent` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow `justifyContent: 'flex-end'` and `'center'` to keep their anchor when main-axis content overflows the container (matching Yoga 3.x and CSS). Closes issue #164; reinstates 2 deferred fixtures from PR #162.

**Architecture:** In `positionItemsInLine` (classic engine) and the two analogous spineless emission sites, split the `leftover` calculation into `leftover` (signed, used by `flex-end` / `center`) and `leftoverPositive` (clamped, used by `space-*`). `space-*` modes' clamped behavior matches Yoga and is preserved.

**Tech Stack:** TypeScript, vitest, pnpm.

**Spec:** `docs/superpowers/specs/2026-05-27-overflow-justify-content-design.md`
**Branch:** `fix/overflow-justify-content` (already created from `3b3e04e`; spec committed at `fea78e2`).
**Closes:** #164.

---

## File Structure

| Path | Change | Responsibility |
|---|---|---|
| `packages/core/src/algorithm/main-axis.ts` | modify | `positionItemsInLine:782` — split leftover. |
| `packages/core/src/algorithm/spineless/flex-grammar.ts` | modify | Two emission sites (lines 2439 and 3238) — same split. |
| `packages/core/src/algorithm/layout.test.ts` | modify | 1 unit test. |
| `packages/core/test/fixtures/justify-content/overflow-row-flex-end.spec.json` | create | reinstated |
| `packages/core/test/fixtures/justify-content/overflow-row-center.spec.json` | create | reinstated |

---

## Task 1: Classic engine — split leftover

**Files:**
- Modify: `packages/core/src/algorithm/main-axis.ts`

- [ ] **Step 1: Locate `positionItemsInLine`.**

Run:
```bash
grep -n "function positionItemsInLine\|const leftover = Math.max" packages/core/src/algorithm/main-axis.ts | head -5
```
Expected: function at line 766, the clamp at 782.

- [ ] **Step 2: Replace the leftover computation + switch.**

Find:

```ts
  const leftover = Math.max(0, innerMain - usedMain);

  let cursor = 0;
  let extraGap = 0;

  switch (justify) {
    case 'flex-end':
      cursor = leftover;
      break;
    case 'center':
      cursor = leftover / 2;
      break;
    case 'space-between':
      if (n > 1) extraGap = leftover / (n - 1);
      break;
    case 'space-around': {
      const slot = leftover / n;
      cursor = slot / 2;
      extraGap = slot;
      break;
    }
    case 'space-evenly': {
      const slot = leftover / (n + 1);
      cursor = slot;
      extraGap = slot;
      break;
    }
    default:
      // flex-start: cursor = 0, extra = 0.
      break;
  }
```

Replace with:

```ts
  // Signed leftover — negative on overflow. `flex-end` and `center` honor
  // the negative value (items spill leftward / both sides); `space-*` modes
  // clamp to 0 (degrading to flex-start on overflow, matching CSS and Yoga).
  const leftover = innerMain - usedMain;
  const leftoverPositive = leftover > 0 ? leftover : 0;

  let cursor = 0;
  let extraGap = 0;

  switch (justify) {
    case 'flex-end':
      cursor = leftover;
      break;
    case 'center':
      cursor = leftover / 2;
      break;
    case 'space-between':
      if (n > 1) extraGap = leftoverPositive / (n - 1);
      break;
    case 'space-around': {
      const slot = leftoverPositive / n;
      cursor = slot / 2;
      extraGap = slot;
      break;
    }
    case 'space-evenly': {
      const slot = leftoverPositive / (n + 1);
      cursor = slot;
      extraGap = slot;
      break;
    }
    default:
      // flex-start: cursor = 0, extra = 0.
      break;
  }
```

- [ ] **Step 3: Typecheck + run existing tests.**

Run: `pnpm typecheck`
Expected: PASS.

Run: `pnpm test packages/core/src/algorithm/`
Expected: PASS. Existing overflow + space-* tests preserved (use `leftoverPositive`).

Run: `pnpm test packages/core/test/fixtures.test.ts`
Expected: PASS. Existing 13 justify-content fixtures from PR #162 (including overflow space-* variants) must still pass.

- [ ] **Step 4: Commit.**

```bash
git add packages/core/src/algorithm/main-axis.ts
git commit -m "fix(core): classic engine honors flex-end/center on overflow (#164)"
```

---

## Task 2: Spineless engine — same split, two sites

**Files:**
- Modify: `packages/core/src/algorithm/spineless/flex-grammar.ts`

The spineless engine has two identical emission sites with the same `Math.max(0, ...)` clamp and the same switch. Both need the split.

- [ ] **Step 1: Verify line numbers.**

Run:
```bash
grep -n "const leftover = Math.max(0, innerMain - usedMain)" packages/core/src/algorithm/spineless/flex-grammar.ts
```
Expected: 2 hits at lines ~2439 and ~3238.

- [ ] **Step 2: Replace the first site (around line 2439, the no-wrap path).**

Find:

```ts
      const leftover = Math.max(0, innerMain - usedMain);
      let leadingOffset = 0;
      let extraGap = 0;
      switch (justify) {
        case 'flex-end':
          leadingOffset = leftover;
          break;
        case 'center':
          leadingOffset = leftover / 2;
          break;
        case 'space-between':
          if (n > 1) extraGap = leftover / (n - 1);
          break;
        case 'space-around': {
          const slot = leftover / n;
          leadingOffset = slot / 2;
          extraGap = slot;
          break;
        }
        case 'space-evenly': {
          const slot = leftover / (n + 1);
          leadingOffset = slot;
          extraGap = slot;
          break;
        }
      }
```

Replace with:

```ts
      // Signed leftover — negative on overflow. flex-end/center honor; space-*
      // clamp to 0 (degrades to flex-start on overflow). Mirrors imperative
      // `positionItemsInLine`. (#164)
      const leftover = innerMain - usedMain;
      const leftoverPositive = leftover > 0 ? leftover : 0;
      let leadingOffset = 0;
      let extraGap = 0;
      switch (justify) {
        case 'flex-end':
          leadingOffset = leftover;
          break;
        case 'center':
          leadingOffset = leftover / 2;
          break;
        case 'space-between':
          if (n > 1) extraGap = leftoverPositive / (n - 1);
          break;
        case 'space-around': {
          const slot = leftoverPositive / n;
          leadingOffset = slot / 2;
          extraGap = slot;
          break;
        }
        case 'space-evenly': {
          const slot = leftoverPositive / (n + 1);
          leadingOffset = slot;
          extraGap = slot;
          break;
        }
      }
```

- [ ] **Step 3: Replace the second site (around line 3238, the wrap path).**

Find:

```ts
  const leftover = Math.max(0, innerMain - usedMain);
  let leadingOffset = 0;
  let extraGap = 0;
  switch (justify) {
    case 'flex-end':
      leadingOffset = leftover;
      break;
    case 'center':
      leadingOffset = leftover / 2;
      break;
    case 'space-between':
      if (myLineCount > 1) extraGap = leftover / (myLineCount - 1);
      break;
    case 'space-around': {
      const slot = leftover / myLineCount;
      leadingOffset = slot / 2;
      extraGap = slot;
      break;
    }
    case 'space-evenly': {
      const slot = leftover / (myLineCount + 1);
      leadingOffset = slot;
      extraGap = slot;
      break;
    }
    default:
      // flex-start
      break;
  }
```

Replace with:

```ts
  // Signed leftover — negative on overflow. flex-end/center honor; space-*
  // clamp to 0 (degrades to flex-start on overflow). Wrap-path mirror of
  // the above no-wrap site. (#164)
  const leftover = innerMain - usedMain;
  const leftoverPositive = leftover > 0 ? leftover : 0;
  let leadingOffset = 0;
  let extraGap = 0;
  switch (justify) {
    case 'flex-end':
      leadingOffset = leftover;
      break;
    case 'center':
      leadingOffset = leftover / 2;
      break;
    case 'space-between':
      if (myLineCount > 1) extraGap = leftoverPositive / (myLineCount - 1);
      break;
    case 'space-around': {
      const slot = leftoverPositive / myLineCount;
      leadingOffset = slot / 2;
      extraGap = slot;
      break;
    }
    case 'space-evenly': {
      const slot = leftoverPositive / (myLineCount + 1);
      leadingOffset = slot;
      extraGap = slot;
      break;
    }
    default:
      // flex-start
      break;
  }
```

- [ ] **Step 4: Typecheck + tests.**

Run: `pnpm typecheck`
Expected: PASS.

Run: `pnpm test:differential 2>&1 | tail -5`
Expected: PASS. Both engines now use the same signed-leftover semantics.

Run: `pnpm test 2>&1 | tail -5`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add packages/core/src/algorithm/spineless/flex-grammar.ts
git commit -m "fix(core): spineless honors flex-end/center on overflow (#164)"
```

---

## Task 3: Unit test for negative cursor

**Files:**
- Modify: `packages/core/src/algorithm/layout.test.ts`

- [ ] **Step 1: Append the test to the end of `packages/core/src/algorithm/layout.test.ts`.**

```ts
describe('justifyContent on main-axis overflow (#164)', () => {
  it('flex-end with overflow places children at negative left', () => {
    const root = Node.create();
    root.setFlexDirection('row');
    root.setJustifyContent('flex-end');
    root.setWidth(40);
    const a = Node.create();
    a.setWidth(30);
    a.setHeight(10);
    a.setFlexShrink(0);
    const b = Node.create();
    b.setWidth(30);
    b.setHeight(10);
    b.setFlexShrink(0);
    root.insertChild(a, 0);
    root.insertChild(b, 1);
    root.calculateLayout();
    // Used = 60, container = 40, leftover = -20.
    // flex-end: cursor = -20, a at -20, b at 10.
    expect(a.getComputedLayout().left).toBe(-20);
    expect(b.getComputedLayout().left).toBe(10);
  });

  it('center with overflow places children spilling both sides', () => {
    const root = Node.create();
    root.setFlexDirection('row');
    root.setJustifyContent('center');
    root.setWidth(40);
    const a = Node.create();
    a.setWidth(30);
    a.setHeight(10);
    a.setFlexShrink(0);
    const b = Node.create();
    b.setWidth(30);
    b.setHeight(10);
    b.setFlexShrink(0);
    root.insertChild(a, 0);
    root.insertChild(b, 1);
    root.calculateLayout();
    // leftover = -20, cursor = -10. a at -10, b at 20.
    expect(a.getComputedLayout().left).toBe(-10);
    expect(b.getComputedLayout().left).toBe(20);
  });
});
```

- [ ] **Step 2: Run + commit.**

Run: `pnpm test packages/core/src/algorithm/layout.test.ts`
Expected: PASS (current count + 2).

```bash
git add packages/core/src/algorithm/layout.test.ts
git commit -m "test(core): overflow justify-content unit tests (#164)"
```

---

## Task 4: Reinstate 2 overflow fixtures

**Files:**
- Create: `packages/core/test/fixtures/justify-content/overflow-row-flex-end.spec.json`
- Create: `packages/core/test/fixtures/justify-content/overflow-row-center.spec.json`

- [ ] **Step 1: Port via `tools/reduce-fixture.ts`.**

Source: `C:/Users/wangz/AppData/Local/Temp/yoga/gentest/fixtures/YGJustifyContentTest.html`. Find `<div id="justify_content_overflow_row_flex_end">` and `<div id="justify_content_overflow_row_center">`. Translate the CSS to a Pilates SpecNode JSON in `/tmp/in.json`. Run:

```bash
pnpm tsx tools/reduce-fixture.ts /tmp/in.json --tag justify-content --name "justify-content/overflow-row-flex-end" --out packages/core/test/fixtures/justify-content/overflow-row-flex-end.spec.json
```

Repeat for `overflow-row-center`. If reduce-fixture warns "Pilates and Yoga produced different layouts": the fix didn't reach that case; investigate and report.

- [ ] **Step 2: Run + format + commit.**

Run: `pnpm test packages/core/test/fixtures.test.ts`
Expected: current count + 2.

```bash
pnpm format
git add packages/core/test/fixtures/justify-content/
git commit -m "test(core): reinstate overflow flex-end/center fixtures (#164)"
```

---

## Task 5: Whole-repo verification

- [ ] **Step 1: `pnpm lint`, `pnpm test`, `pnpm test:differential`, `pnpm typecheck`, `pnpm run ci`.** All green.

---

## Task 6: Push + PR + close #164

- [ ] **Step 1: Push.**

```bash
git push -u origin fix/overflow-justify-content
```

- [ ] **Step 2: Open PR.**

```bash
gh pr create --base main --title "fix(core): honor justify-content flex-end/center on main-axis overflow (closes #164)" --body "$(cat <<'EOF'
## Summary

When children's combined main-axis size exceeds the container's main size and \`flexShrink: 0\` prevents shrinking, Yoga 3.x continues to honor \`justifyContent: 'flex-end' | 'center'\` by placing children at negative positions. Pilates today clamps free space to 0, falling back to flex-start. This PR splits the leftover calculation so \`flex-end\` / \`center\` use the signed value (negative on overflow) while \`space-*\` keeps the clamped value (matches Yoga's flex-start fallback for distribution modes).

Closes #164. Reinstates 2 fixtures deferred by PR #162.

## Changes

- \`packages/core/src/algorithm/main-axis.ts\` — \`positionItemsInLine\` uses \`leftover\` (signed) for flex-end/center and \`leftoverPositive\` for space-*.
- \`packages/core/src/algorithm/spineless/flex-grammar.ts\` — same split at the two emission sites (no-wrap path + wrap path).
- \`packages/core/src/algorithm/layout.test.ts\` — 2 unit tests.
- \`packages/core/test/fixtures/justify-content/overflow-row-flex-end.spec.json\` — reinstated.
- \`packages/core/test/fixtures/justify-content/overflow-row-center.spec.json\` — reinstated.

## Test plan

- [x] \`pnpm test\`
- [x] \`pnpm test:differential\`
- [x] \`pnpm typecheck\`
- [x] \`pnpm lint\`
- [x] \`pnpm run ci\`

Closes #164.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review notes

**Spec coverage:**
- Classic engine split → Task 1
- Spineless engine split (both sites) → Task 2
- 2 unit tests → Task 3
- 2 fixture reinstatement → Task 4
- DoD all-green → Task 5
- Close #164 → Task 6

**Type consistency:** `leftover` (signed) and `leftoverPositive` (clamped) used consistently across all three emission sites.

**Memory pointers:**
- `feedback_pilates_typecheck_command` — `pnpm typecheck`.
- `feedback_pilates_branch_pr_workflow` — branch + PR.
- `feedback_pnpm_script_name_collisions` — `pnpm run ci`.
