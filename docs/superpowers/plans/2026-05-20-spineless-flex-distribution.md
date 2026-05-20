# Spineless flex-distribution grammar refactor — phase 12 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the per-cell O(N²) flex-distribution recompute in the Spineless grammar with one O(N) parent-level intermediate Field; preserve every behavior; clear the success-criteria thresholds in `docs/superpowers/specs/2026-05-20-spineless-flex-distribution-design.md`.

**Architecture:** For every flex-distributing parent (`parentNeedsFlexDistribution(parent) === true`), single-line (`flexWrap === 'nowrap' | undefined`), default `justifyContent === 'flex-start'`, emit one `mainDistribution: Field<MainAxisDistribution>` rule whose `compute` runs `distributeMainAxis(...)` once + folds positions. Each in-flow child's `mainSize` and `mainPos` rules collapse to `read(mainDistribution).sizes[myIndex]` / `.positions[myIndex]`. Non-qualifying parents (wrap, non-default justify, no-flex-distribution) keep today's rules. Runtime, driver, router untouched.

**Tech Stack:** TypeScript 5.7 (NodeNext ESM), Vitest, fast-check fuzzer, yoga-layout (WASM, validation oracle), tinybench. pnpm workspace.

---

## File Structure

```
packages/core/src/algorithm/spineless/
  flex-grammar.ts                                  MODIFY — new type + new emitMainDistribution helper; mainSize/mainPos rule collapse in the flex-distribute branch; fragment-builder patches
  flex-grammar.distribution.test.ts                NEW    — unit tests for the new Field + dep structure
bench/scenarios/
  hot-relayout-flex-distribution.ts                NEW    — micro-bench locking in the perf result
bench/index.ts                                     MODIFY — register the new scenario
bench/thresholds.json                              MODIFY — tighten the loosened hotrelayoutboundary/hotrelayout floors after the win lands
```

No other files change. The runtime (`runtime.ts`), driver (`layout.ts`), router (`algorithm/index.ts`), and `Node` type are not touched.

---

### Task 1: `MainAxisDistribution` type + `emitMainDistribution` helper (preparatory, no wiring)

**Files:**
- Modify: `packages/core/src/algorithm/spineless/flex-grammar.ts` — add the type + the helper near the top of the in-flow-children emission block (the existing helper-functions area around lines 250–880 is the precedent for where local helpers live).
- Test: `packages/core/src/algorithm/spineless/flex-grammar.distribution.test.ts` (new)

- [ ] **Step 1: Add the failing test**

Create `packages/core/src/algorithm/spineless/flex-grammar.distribution.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { Node } from '../../node.js';
import { buildFlexGrammar } from './flex-grammar.js';

/**
 * Phase-12 unit tests: the per-parent `mainDistribution` intermediate
 * Field. Validates structure (presence / deps), not full layout
 * correctness — the yoga-oracle + differential fuzzer cover output.
 */

function row(setupCell: (cell: Node, i: number) => void, count = 4): Node {
  const root = Node.create();
  root.setFlexDirection('row');
  root.setWidth(200);
  root.setHeight(20);
  for (let i = 0; i < count; i++) {
    const cell = Node.create();
    setupCell(cell, i);
    root.insertChild(cell, i);
  }
  return root;
}

describe('phase 12 — mainDistribution Field', () => {
  test('emitted when the parent flex-distributes', () => {
    const root = row((c) => c.setFlex(1));
    const { grammar } = buildFlexGrammar(root);
    const parentMainDistFields = [...grammar.keys()].filter(
      (f) => f.node === root && f.name === 'mainDistribution',
    );
    expect(parentMainDistFields).toHaveLength(1);
  });

  test('NOT emitted when no child has flex weight (no flex distribution)', () => {
    const root = row((c) => {
      c.setWidth(50);
      c.setHeight(20);
    });
    const { grammar } = buildFlexGrammar(root);
    const parentMainDistFields = [...grammar.keys()].filter(
      (f) => f.node === root && f.name === 'mainDistribution',
    );
    expect(parentMainDistFields).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @pilates/core test -- flex-grammar.distribution`
Expected: FAIL — both tests fail because no `mainDistribution` Field is emitted.

- [ ] **Step 3: Add the type + helper in `flex-grammar.ts`**

Add this `interface` near the top of `flex-grammar.ts` (next to `DistributeSibling` around line 2105):

```ts
/**
 * The materialised result of a flex-distributing parent's main-axis
 * pass — sizes plus folded positions. One per qualifying parent.
 * Cells index into this instead of redoing the distribution each.
 * @internal
 */
export interface MainAxisDistribution {
  readonly sizes: readonly number[];
  readonly positions: readonly number[];
}
```

Add this helper near the other emission helpers (e.g. just before `emitJustifiedMainPos`):

```ts
/**
 * Emit the parent-level main-axis distribution Field for a
 * flex-distributing parent. Returns the Field so the per-child
 * mainSize / mainPos rules can declare it as their dependency.
 *
 * `deps` is the SAME deps list today's per-cell mainSizeField
 * rule declares (parent main, gap, padding, plus each in-flow
 * sibling's eight flex-related inputs).
 */
function emitMainDistribution(
  grammar: Grammar,
  parent: Node,
  flexSibs: SizeInputs[],
  parentMainField: Field<number>,
  mainGapInput: Field<number>,
  padMainStartF: Field<number>,
  padMainEndF: Field<number>,
  marginInput: (n: Node, edge: Edge) => Field<number>,
  parentDirection: FlexDirection,
): Field<MainAxisDistribution> {
  const mainDistField = field<MainAxisDistribution>(parent, 'mainDistribution');
  const deps: Field<unknown>[] = [
    parentMainField as Field<unknown>,
    mainGapInput as Field<unknown>,
    padMainStartF as Field<unknown>,
    padMainEndF as Field<unknown>,
  ];
  for (const s of flexSibs) {
    deps.push(
      s.flexBasisInput as Field<unknown>,
      s.mainInput as Field<unknown>,
      s.growInput as Field<unknown>,
      s.shrinkInput as Field<unknown>,
      s.marginMainStartInput as Field<unknown>,
      s.marginMainEndInput as Field<unknown>,
      s.minInput as Field<unknown>,
      s.maxInput as Field<unknown>,
    );
  }
  const mainStartEdgeName = mainStartEdge(parentDirection);
  const mainEndEdgeName = mainEndEdge(parentDirection);
  grammar.set(mainDistField as Field<unknown>, {
    deps,
    compute: (read) => {
      const innerMain = Math.max(
        0,
        read(parentMainField) - read(padMainStartF) - read(padMainEndF),
      );
      const siblings = liveFlexSiblings(flexSibs, read);
      const sizes = distributeMainAxis(siblings, innerMain, read(mainGapInput));

      // Fold sizes + margins + gaps into a prefix-sum positions array.
      // positions[i] is the i-th in-flow child's main offset within
      // the parent's main-axis content box origin (i.e. relative to
      // parent's main-start padding edge, NOT including padding).
      const positions = new Array<number>(sizes.length);
      const gap = read(mainGapInput);
      const startPad = read(padMainStartF);
      let cursor = startPad;
      for (let i = 0; i < sizes.length; i++) {
        const sib = flexSibs[i]!;
        const marginStart = read(marginInput(sib.node, mainStartEdgeName));
        const marginEnd = read(marginInput(sib.node, mainEndEdgeName));
        if (i > 0) cursor += gap;
        cursor += marginStart;
        positions[i] = cursor;
        cursor += sizes[i]! + marginEnd;
      }
      return { sizes, positions };
    },
  } satisfies FieldRule<MainAxisDistribution>);
  return mainDistField;
}
```

Notes for the implementer:
- `Edge` / `mainStartEdge` / `mainEndEdge` / `FlexDirection` / `SizeInputs` are existing names in this file. Match the imports/usages of the nearby helpers.
- `field<T>(node, name)` is the existing Field constructor — used hundreds of times in this file.
- The `compute` closure must not retain references to live `Node.style` arrays — only the captured `flexSibs` (which holds Field refs that the runtime keeps in sync via `read`).

- [ ] **Step 4: The helper is unused; verify type-check + test still fails**

Run: `pnpm typecheck`
Expected: clean — the new type / helper compile.

Run: `pnpm --filter @pilates/core test -- flex-grammar.distribution`
Expected: STILL FAIL — the helper exists but isn't called from `buildFlexGrammar` yet, so no `mainDistribution` Field appears in the grammar.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/algorithm/spineless/flex-grammar.ts packages/core/src/algorithm/spineless/flex-grammar.distribution.test.ts
git commit -m "$(cat <<'EOF'
phase 12: MainAxisDistribution type + emitMainDistribution helper

Preparatory commit — adds the type and the per-parent rule emitter
but does not yet call it from buildFlexGrammar. Existing layout
behaviour is unchanged.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Call `emitMainDistribution` from `buildFlexGrammar` + collapse cell `mainSize` rules

**Files:**
- Modify: `packages/core/src/algorithm/spineless/flex-grammar.ts` — the in-flow `mainSizeField` emission block (around lines 937–988) gains a regime check and emits-once-per-parent.
- Test: `packages/core/src/algorithm/spineless/flex-grammar.distribution.test.ts` (extend)

- [ ] **Step 1: Add a failing test for cell `mainSize` dep collapse**

Append to `flex-grammar.distribution.test.ts`:

```ts
describe('phase 12 — cell mainSize collapses to mainDistribution read', () => {
  test('cell mainSize deps reference only mainDistribution (qualifying parent)', () => {
    const root = row((c) => c.setFlex(1), 4);
    const { grammar } = buildFlexGrammar(root);
    const mainDist = [...grammar.keys()].find(
      (f) => f.node === root && f.name === 'mainDistribution',
    );
    expect(mainDist).toBeDefined();

    for (let i = 0; i < 4; i++) {
      const cell = root.getChild(i)!;
      const cellMainSize = [...grammar.keys()].find(
        (f) => f.node === cell && f.name === 'width',
      );
      expect(cellMainSize).toBeDefined();
      const rule = grammar.get(cellMainSize!)!;
      expect(rule.deps).toEqual([mainDist]);
    }
  });

  test('cell mainSize keeps sibling deps when parent does NOT qualify (wrap)', () => {
    const root = row((c) => c.setFlex(1), 4);
    root.setFlexWrap('wrap');
    const { grammar } = buildFlexGrammar(root);
    // No mainDistribution emitted under wrap.
    const mainDist = [...grammar.keys()].find(
      (f) => f.node === root && f.name === 'mainDistribution',
    );
    expect(mainDist).toBeUndefined();
    // Cell mainSize rule still has its old multi-sibling deps shape.
    const cell0Width = [...grammar.keys()].find(
      (f) => f.node === root.getChild(0) && f.name === 'width',
    )!;
    expect(grammar.get(cell0Width)!.deps.length).toBeGreaterThan(1);
  });
});
```

- [ ] **Step 2: Run test, verify fails**

Run: `pnpm --filter @pilates/core test -- flex-grammar.distribution`
Expected: FAIL — the qualifying-parent test fails because cell `width` rule still has the multi-sibling deps shape; the wrap test passes (sanity check it's exercising the right code path).

- [ ] **Step 3: Add regime gating + wire `emitMainDistribution`**

In `flex-grammar.ts`, locate the flex-distribution `else` branch (line ~937, the block that today builds `flexSibs` and emits the per-cell `mainSizeField` rule with `distributeMainAxis(siblings, …)[myIndex]`).

Above the existing per-cell emission, hoist a per-parent emission. Pseudo-shape:

```ts
// Phase 12 regime check: only flex-start + nowrap qualify for the
// O(N) intermediate Field. Other regimes keep the per-cell path.
const isPhase12Regime =
  parent.style.justifyContent === 'flex-start' &&
  (parent.style.flexWrap === undefined || parent.style.flexWrap === 'nowrap');

let parentMainDist: Field<MainAxisDistribution> | undefined;
if (isPhase12Regime) {
  // Emit once per parent. flexSibs is the same in-flow list each
  // child iteration would have constructed; build it once here.
  // (If buildFlexGrammar's existing iteration already constructs
  // flexSibs at per-child granularity, lift the construction so the
  // parent + cells share one instance — match the existing pattern.)
  parentMainDist = output.mainDistributionByParent.get(parent);
  if (parentMainDist === undefined) {
    parentMainDist = emitMainDistribution(
      grammar,
      parent,
      flexSibs,
      parentMainField,
      mainGapInput,
      padMainStartF!,
      padMainEndF!,
      marginInput,
      parentDirection!,
    );
    output.mainDistributionByParent.set(parent, parentMainDist);
  }
}

// Per-child mainSize rule.
if (parentMainDist !== undefined) {
  const myIndexCapture = myIndex;
  grammar.set(mainSizeField as Field<unknown>, {
    deps: [parentMainDist as Field<unknown>],
    compute: (read) => read(parentMainDist!).sizes[myIndexCapture]!,
  } satisfies FieldRule<number>);
} else {
  // Existing per-cell path: keep today's
  // distributeMainAxis(...)[myIndex] rule unchanged.
  grammar.set(mainSizeField, /* existing per-cell rule */);
}
```

`mainDistributionByParent` is a new `Map<Node, Field<MainAxisDistribution>>` field on `FlexGrammarOutput` (declared next to its existing maps like `styleInputs` / `availableInputs`). Initialise it to a fresh empty `Map` at the top of `buildFlexGrammar`'s body. Persisting it on `output` is what lets the fragment builders (Task 4) consult it after the initial build.

The "lift `flexSibs` to per-parent" point: in the existing code each in-flow child iteration constructs `flexSibs` (lines ~940–957). If today's structure builds it inside the child loop, restructure so `flexSibs` is built once per parent (the structural signature is the same per parent's children); per-child code uses `flexSibs[myIndex]`. This is mechanical refactoring — do not change the construction logic, only the loop scope. (The implementer should follow the existing helper-extraction pattern; if this restructure is significant, factor it into its own sub-step.)

- [ ] **Step 4: Run the new test, verify pass**

Run: `pnpm --filter @pilates/core test -- flex-grammar.distribution`
Expected: PASS — both new tests + the Task 1 tests pass.

- [ ] **Step 5: Run the full core suite — REGRESSION NET**

Run: `pnpm --filter @pilates/core test`
Expected: ALL PASS. This is the critical correctness gate — the yoga oracle (33 fixtures), the value-differential fuzzer, the structural fuzzer, and the in-place layout tests must all be unchanged. If anything goes red, the dep-edge or `myIndex` capture is wrong.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/algorithm/spineless/flex-grammar.ts packages/core/src/algorithm/spineless/flex-grammar.distribution.test.ts
git commit -m "$(cat <<'EOF'
phase 12: emit mainDistribution + collapse cell mainSize rules

For flex-distributing single-line parents with default flex-start
justify, the grammar now emits one mainDistribution Field per parent
and each in-flow child's mainSize is a trivial array read. Other
regimes (wrap, non-default justify, no-flex-distribution) keep the
per-cell rule shape unchanged.

Yoga oracle + differential fuzzer + structural fuzzer green.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Collapse cell `mainPos` rules in flex-start regime

**Files:**
- Modify: `packages/core/src/algorithm/spineless/flex-grammar.ts` — the `mainPos` flex-start emission (lines ~1042–1067 today).
- Test: `packages/core/src/algorithm/spineless/flex-grammar.distribution.test.ts` (extend)

- [ ] **Step 1: Add the failing test for `mainPos` dep collapse**

Append to `flex-grammar.distribution.test.ts`:

```ts
describe('phase 12 — cell mainPos collapses to mainDistribution read', () => {
  test('cell mainPos deps reference only mainDistribution (qualifying parent)', () => {
    const root = row((c) => c.setFlex(1), 4);
    const { grammar } = buildFlexGrammar(root);
    const mainDist = [...grammar.keys()].find(
      (f) => f.node === root && f.name === 'mainDistribution',
    )!;
    for (let i = 0; i < 4; i++) {
      const cell = root.getChild(i)!;
      const cellMainPos = [...grammar.keys()].find(
        (f) => f.node === cell && f.name === 'left',
      );
      expect(cellMainPos).toBeDefined();
      expect(grammar.get(cellMainPos!)!.deps).toEqual([mainDist]);
    }
  });

  test('cell mainPos keeps prior-siblings deps when justify is non-default', () => {
    const root = row((c) => c.setFlex(1), 4);
    root.setJustifyContent('center');
    const { grammar } = buildFlexGrammar(root);
    // Even if mainDistribution is emitted for sizes (phase-12 covers
    // sizes regardless of justify), mainPos in non-default justify
    // keeps its existing emitJustifiedMainPos rule shape.
    const cell1Left = [...grammar.keys()].find(
      (f) => f.node === root.getChild(1) && f.name === 'left',
    )!;
    expect(grammar.get(cell1Left)!.deps.length).toBeGreaterThan(1);
  });
});
```

(Note: the second test assumes phase 12's mainSize emission covers `justify-content !== 'flex-start'` parents too. If the regime gate for `mainDistribution` is *also* tied to `flex-start`, adjust the test — but the spec says sizes are emitted whenever the parent flex-distributes, only mainPos is regime-gated.)

**Resolving the ambiguity here:** the spec is explicit — phase 12 covers mainSize for any flex-distributing single-line parent, and mainPos *only* under `justify-content: flex-start`. So Task 2's mainSize emission should NOT gate on `justify === 'flex-start'`; only mainPos does. If Task 2 over-gated, fix it before this task: in Task 2's `isPhase12Regime` check, drop the `justifyContent` clause for mainSize; introduce a separate `isFlexStartRegime` check that gates only mainPos.

- [ ] **Step 2: Run test, verify fails**

Run: `pnpm --filter @pilates/core test -- flex-grammar.distribution`
Expected: FAIL — first new test fails (mainPos still has prior-siblings deps); second passes.

- [ ] **Step 3: Collapse mainPos rule for flex-start regime**

In `flex-grammar.ts` around line 1042 (the `} else if (justify === 'flex-start') {` branch for cells with `indexInParent > 0`), and around line 1014 (the `indexInParent === 0` flex-start branch), replace today's emission with:

```ts
// Phase 12: read directly from the parent's mainDistribution if it
// was emitted (parent flex-distributes + single-line). Fallback to
// today's prior-siblings rule when the parent didn't qualify.
const parentMainDist = output.mainDistributionByParent.get(parent);
if (parentMainDist !== undefined) {
  const myIndexCapture = indexInParent;
  grammar.set(mainPosField, {
    deps: [parentMainDist as Field<unknown>],
    compute: (read) => read(parentMainDist).positions[myIndexCapture]!,
  } satisfies FieldRule<number>);
} else {
  // Existing prior-siblings-sum emission — keep unchanged.
  // ... today's code ...
}
```

- [ ] **Step 4: Run the new test, verify pass**

Run: `pnpm --filter @pilates/core test -- flex-grammar.distribution`
Expected: PASS.

- [ ] **Step 5: Run full core suite — REGRESSION NET**

Run: `pnpm --filter @pilates/core test`
Expected: ALL PASS, including the yoga oracle and differential fuzzers. Positions are the half of layout that's *most* sensitive to wrong dep edges — if positions are stale, the differential fuzzer will scream.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/algorithm/spineless/flex-grammar.ts packages/core/src/algorithm/spineless/flex-grammar.distribution.test.ts
git commit -m "$(cat <<'EOF'
phase 12: collapse cell mainPos rules in flex-start regime

Cell mainPos now reads positions[myIndex] from the parent
mainDistribution Field in the default flex-start + single-line
regime. Non-default justify (handled by emitJustifiedMainPos) and
non-qualifying parents are unchanged.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Patch fragment builders to rebind `mainDistribution` on structural change

**Files:**
- Modify: `packages/core/src/algorithm/spineless/flex-grammar.ts` — `buildAppendFragment`, `buildRemoveFragment`, `buildReorderFragment` (lines ~1241+, ~1466+, and equivalents).

The structural-differential fuzzer (`spineless-structural.fuzz.test.ts`) IS the validation. The TDD shape for this task is "run the fuzzer, observe failure, fix builder, fuzzer passes."

- [ ] **Step 1: Run the structural-differential fuzzer; capture the failure mode**

Run: `pnpm --filter @pilates/core test -- spineless-structural.fuzz`
Expected: AFTER Tasks 2–3 land, the fuzzer **likely fails** on append/remove/reorder operations that touch a flex-distributing parent. Capture the first failing seed.

The failure mode: when a child is appended/removed/reordered, the fragment builders patch each affected cell's rule but the *parent's* `mainDistribution` rule's deps array + compute closure are stale (its `flexSibs` list no longer reflects the live in-flow children). The runtime evaluates a stale distribution → cells read stale `sizes[myIndex]` → divergence.

- [ ] **Step 2: Patch `buildAppendFragment` to rebind `mainDistribution`**

In `buildAppendFragment` (line ~1241), after the existing `rebinds` are collected for sibling cells:

```ts
// Phase 12: a child append changes the parent's flexSibs list, so
// the parent's mainDistribution rule (if emitted) needs a fresh
// rule with the new deps + compute closure.
const phase12ParentDist = output.mainDistributionByParent.get(parent);
if (phase12ParentDist !== undefined) {
  const newFlexSibs = buildFlexSibsForParent(parent /* ... */);
  const newRule = makeMainDistributionRule(
    parent, newFlexSibs, /* parentMainField, mainGapInput, paddings, etc. */
  );
  rebinds.set(phase12ParentDist, newRule);
}
```

The exact form depends on the existing `output` shape — the implementer reads `FlexGrammarOutput` (defined earlier in the file) and adds a `mainDistributionByParent: Map<Node, Field<MainAxisDistribution>>` to it. That map is populated in Task 2's emission code and consumed here.

`makeMainDistributionRule` is a small extraction from Task 1's `emitMainDistribution` body — same compute, just returned as a rule rather than grammar.set'd. Refactor to share code: `emitMainDistribution` becomes `makeMainDistributionRule` + a `grammar.set` of the result.

- [ ] **Step 3: Patch `buildRemoveFragment` analogously**

Same shape: after the cell rebinds, if the parent has a `mainDistribution`, rebind it with the post-removal flexSibs.

- [ ] **Step 4: Patch `buildReorderFragment` analogously**

A reorder changes `myIndex` for some children but not the parent's `flexSibs` set. Two effects: (a) the parent's `mainDistribution` `flexSibs` order changes (positions[i] map to different nodes), so the rule's compute closure must be rebuilt; (b) cells' `mainSize` / `mainPos` rule closures capture the *new* `myIndex`. The existing reorder builder already patches (b); add (a).

- [ ] **Step 5: Run the structural fuzzer until it stabilises**

Run: `pnpm --filter @pilates/core test -- spineless-structural.fuzz`
Expected: PASS (default 200 runs). If a seed still reproduces a failure, fix and re-run. Pin any deterministic regression seed as a `test.each` entry per the project's existing pattern (see how phase-11 v33 fuzzer fixes pinned their seeds in this same file).

- [ ] **Step 6: Run the full core suite**

Run: `pnpm --filter @pilates/core test`
Expected: ALL PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/algorithm/spineless/flex-grammar.ts
git commit -m "$(cat <<'EOF'
phase 12: patch fragment builders to rebind mainDistribution

buildAppendFragment / buildRemoveFragment / buildReorderFragment
now rebind the parent's mainDistribution rule when a structural
change touches its in-flow children. The structural-differential
fuzzer covers correctness across random insert/remove/move sequences.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Full validation sweep

**Files:** none touched in this task. Run the existing gates.

- [ ] **Step 1: Lint + typecheck**

Run: `pnpm lint && pnpm typecheck`
Expected: clean.

- [ ] **Step 2: Full workspace test suite**

Run: `pnpm test`
Expected: all suites pass — `@pilates/core`, `@pilates/render`, `@pilates/diff`, `@pilates/react`, `@pilates/widgets`, e2e.

- [ ] **Step 3: Differential mode across the whole workspace**

Run: `pnpm test:differential`
Expected: pass. This runs every `calculateLayout` in `@pilates/core` tests twice (cached + cold) and asserts byte-identical layouts.

- [ ] **Step 4: 200-run fast-check fuzz**

The fast-check fuzzers in `cache.fuzz.test.ts`, `runtime-incremental.fuzz.test.ts`, and `spineless-structural.fuzz.test.ts` already run on every test invocation. If any of them flake intermittently, capture the seed and pin a deterministic regression test (project pattern — see prior phase fuzzer fixes).

- [ ] **Step 5: If anything is red, STOP and diagnose**

Do not proceed to bench measurement until the validation suite is green. The bench is meaningless if correctness is broken.

- [ ] **Step 6: Commit any fuzzer-pinned regression tests separately (if any landed)**

```bash
# Only if fuzz runs surfaced a deterministic seed that needs pinning
git add packages/core/src/algorithm/spineless/spineless-structural.fuzz.test.ts
git commit -m "phase 12: pin structural-fuzzer regression seed <SEED>"
```

---

### Task 6: Bench measurement — before and after, comparable run

**Files:** none modified in this task; pure measurement.

- [ ] **Step 1: Run the full bench on the current commit**

Run: `pnpm -w run bench`
Expected: writes `bench/RESULTS.md` with fresh numbers. Note all medians, especially `hotrelayoutboundary`, `hotrelayout`, `hotrelayouttext`, `hotstructural`, and the build-then-layout scenarios.

- [ ] **Step 2: Verify success criteria**

Check the `hotrelayoutboundary` row:
- `@pilates/core (layout)` median must be **≤ 83µs** (Yoga's number this run). Target ≤ 30µs.

Check the `hotrelayout` row:
- `@pilates/core (layout)` median must be **≤ 92µs** (Yoga's number this run).

Check every other scenario:
- `@pilates/core (layout)` median must be **≤** the median that scenario had before phase 12. Use git history to compare: `git show main:bench/RESULTS.md` for the pre-phase-12 baseline.

- [ ] **Step 3: If a success criterion fails, diagnose**

Possible diagnoses:
1. **Constant factor too high** — profile via Node `--cpu-prof`; common cause is array-allocation churn in the `mainDistribution` compute (allocating two arrays per call). Mitigation: pool/reuse arrays internal to the runtime (out of phase-12 scope), or simply accept the partial win if it clears Yoga.
2. **Another O(N²) site dominates** — likely `emitJustifiedMainPos` (non-default justify) or cross-axis under wrap. Out of phase-12 scope; document for phase 13.
3. **The mainDistribution rule fires more than expected** — instrument with `runtime.stats.recomputeVisited` per call. If it fires >1 per mutation, the dep edges are wrong.

If after diagnosis we land worse than Yoga, **STOP** — the spec's success criteria aren't met. Surface this to the controller / human to decide between (a) extend phase 12 scope, (b) ship partial + add the option-1 router boundary fast-path as phase 12.5.

- [ ] **Step 4: If success criteria pass, record the numbers + commit RESULTS.md**

```bash
git add bench/RESULTS.md
git commit -m "$(cat <<'EOF'
bench: refresh RESULTS.md after phase 12 flex-distribution refactor

hotrelayoutboundary: <before>µs → <after>µs
hotrelayout:          <before>µs → <after>µs
Other scenarios:      no regression (see file).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Fill in the actual numbers.

---

### Task 7: Micro-bench + tighten thresholds

**Files:**
- Create: `bench/scenarios/hot-relayout-flex-distribution.ts`
- Modify: `bench/index.ts` (register the scenario)
- Modify: `bench/thresholds.json` (tighten the loosened floors)

- [ ] **Step 1: Create the micro-bench scenario**

Create `bench/scenarios/hot-relayout-flex-distribution.ts`:

```ts
/**
 * Hot-relayout-flex-distribution scenario: a 1k-node persistent tree
 * with explicit-sized rows + flex cells, mutate one cell's flex per
 * iteration. The exact workload phase 12's mainDistribution Field
 * targets. Mirrors hot-relayout-boundary.ts's tree shape and adds a
 * tighter threshold to lock in the win.
 */

import { Node } from '@pilates/core';
import Yoga from 'yoga-layout';

const COLS = 200;
const ROWS = 100;
const ROW_COUNT = 50;
const CELLS_PER_ROW = 20;
const CELL_HEIGHT = ROWS / ROW_COUNT;

let pilatesRoot: Node;
let pilatesTargetLeaf: Node;
let pilatesToggle = false;

function buildPilatesPersistent(): void {
  const root = Node.create();
  root.setFlexDirection('column');
  root.setWidth(COLS);
  root.setHeight(ROWS);
  let firstLeaf: Node | undefined;
  for (let r = 0; r < ROW_COUNT; r++) {
    const row = Node.create();
    row.setFlexDirection('row');
    row.setWidth(COLS);
    row.setHeight(CELL_HEIGHT);
    root.insertChild(row, r);
    for (let c = 0; c < CELLS_PER_ROW; c++) {
      const cell = Node.create();
      cell.setFlex(1);
      row.insertChild(cell, c);
      if (firstLeaf === undefined) firstLeaf = cell;
    }
  }
  pilatesRoot = root;
  pilatesTargetLeaf = firstLeaf!;
  root.calculateLayout(COLS, ROWS);
}

buildPilatesPersistent();

export function pilatesCoreLayout(): void {
  pilatesToggle = !pilatesToggle;
  pilatesTargetLeaf.setFlex(pilatesToggle ? 1 : 2);
  pilatesRoot.calculateLayout(COLS, ROWS);
}

export function pilatesFullRender(): void {
  pilatesCoreLayout();
}

let yogaRoot: import('yoga-layout').Node | undefined;
let yogaTarget: import('yoga-layout').Node | undefined;
let yogaToggle = false;

function buildYogaPersistent(): void {
  if (yogaRoot !== undefined) return;
  const root = Yoga.Node.create();
  root.setFlexDirection(Yoga.FLEX_DIRECTION_COLUMN);
  root.setWidth(COLS);
  root.setHeight(ROWS);
  let first: import('yoga-layout').Node | undefined;
  for (let r = 0; r < ROW_COUNT; r++) {
    const row = Yoga.Node.create();
    row.setFlexDirection(Yoga.FLEX_DIRECTION_ROW);
    row.setWidth(COLS);
    row.setHeight(CELL_HEIGHT);
    root.insertChild(row, r);
    for (let c = 0; c < CELLS_PER_ROW; c++) {
      const cell = Yoga.Node.create();
      cell.setFlex(1);
      row.insertChild(cell, c);
      if (first === undefined) first = cell;
    }
  }
  yogaRoot = root;
  yogaTarget = first;
  root.calculateLayout(undefined, undefined, Yoga.DIRECTION_LTR);
}

buildYogaPersistent();

export function yogaLayout(): void {
  yogaToggle = !yogaToggle;
  yogaTarget!.setFlex(yogaToggle ? 1 : 2);
  yogaRoot!.calculateLayout(undefined, undefined, Yoga.DIRECTION_LTR);
}
```

- [ ] **Step 2: Register the scenario in `bench/index.ts`**

Open `bench/index.ts`, locate the existing scenario list (next to `hot-relayout-text`), and add the new scenario alongside, following the same import + add-to-array pattern the existing scenarios use. The exact form depends on `bench/index.ts`'s shape — match the surrounding code.

- [ ] **Step 3: Run the bench, confirm the new scenario appears in RESULTS.md**

Run: `pnpm -w run bench`
Expected: `bench/RESULTS.md` now includes an `hot-relayout-flex-distribution` section with median latencies.

- [ ] **Step 4: Tighten `bench/thresholds.json`**

Open `bench/thresholds.json`. The phase-8 loosened budgets:

```json
"hotrelayout": { "@pilates/core (layout)": { "maxMeanMs": 1.5 } },
"hotrelayoutboundary": { "@pilates/core (layout)": { "maxMeanMs": 1.5 } },
```

Replace with (using Task 6's measured medians as the basis, with ~3× dev-local headroom per `feedback_pilates_ci_bench_variance` memory — CI runs ~5× dev-local on this repo, so threshold = `~5× measured median`):

```json
"hotrelayout": { "@pilates/core (layout)": { "maxMeanMs": <round to nearest 0.05 of 5×measured> } },
"hotrelayoutboundary": { "@pilates/core (layout)": { "maxMeanMs": <round to nearest 0.05 of 5×measured> } },
```

Add an entry for the new scenario:

```json
"hot-relayout-flex-distribution": {
  "@pilates/core (layout)": { "maxMeanMs": <5× measured median> }
}
```

If Task 6's medians on this Windows machine were e.g. 30µs (= 0.03ms) for hotrelayoutboundary, set `maxMeanMs: 0.15` (5× ≈ 0.15ms). Match the CI-headroom convention.

- [ ] **Step 5: Run `pnpm -w run bench:budgets` — confirm green**

Run: `pnpm -w run bench:budgets`
Expected: PASS — every scenario's measured mean is under its threshold. If the threshold is too tight, loosen by 0.05ms increments until green; if too loose, tighten. The goal: leave headroom for CI noise but tight enough that a real regression fails.

- [ ] **Step 6: Commit**

```bash
git add bench/scenarios/hot-relayout-flex-distribution.ts bench/index.ts bench/thresholds.json bench/RESULTS.md
git commit -m "$(cat <<'EOF'
bench: add hot-relayout-flex-distribution micro-bench + tighten budgets

New scenario locks in phase 12's perf result with a CI-checked
budget. hotrelayout / hotrelayoutboundary budgets tightened from
the phase-8 loosened 1.5ms back toward the original 0.1ms class.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**Spec coverage:**
- `MainAxisDistribution` type — Task 1 Step 3. ✓
- `mainDistribution` Field emission per flex-distributing single-line parent — Task 2 Step 3. ✓
- Cell `mainSize` collapses to `read(mainDistribution).sizes[myIndex]` — Task 2 Step 3. ✓
- Cell `mainPos` collapses to `read(mainDistribution).positions[myIndex]` in flex-start regime — Task 3 Step 3. ✓
- Regime gating: only `parentNeedsFlexDistribution` + single-line for mainSize; additionally `flex-start` for mainPos. Wrap / non-default justify / no-flex-distribution kept on existing paths — Tasks 2–3. ✓
- Fragment builders updated for the new parent rule — Task 4. ✓
- `display:none` siblings — handled implicitly by the existing `isInFlow` filter used in `flexSibs` construction; no new code needed (verified by structural fuzzer in Task 4 Step 5). ✓
- `myIndex` closure preserved — Tasks 2–3 explicitly capture `myIndex` / `indexInParent` in the closure. ✓
- Validation gates (yoga oracle, fuzzers, differential mode) — Task 5. ✓
- Performance gates (hotrelayoutboundary ≤ 83µs, hotrelayout ≤ 92µs, no other regression) — Task 6 Step 2. ✓
- New unit test file `flex-grammar.distribution.test.ts` — Tasks 1–3 build it up. ✓
- New micro-bench `bench/scenarios/hot-relayout-flex-distribution.ts` — Task 7. ✓
- Tightened `bench/thresholds.json` — Task 7 Step 4. ✓
- Single-engine architecture preserved (router / driver / runtime untouched) — none of the tasks modify those files. ✓
- Rollback path (router boundary fast-path) documented in spec; Task 6 Step 3 surfaces a failure path to the controller. ✓

**Placeholder scan:** Task 4's "exact form depends on the existing `output` shape" and Task 7 Step 2's "match the surrounding code" — both call out where the implementer follows existing patterns rather than hard-coding code that may not match the actual `FlexGrammarOutput` / `bench/index.ts` shape. These are concrete pointers (named functions, named files, what to look for), not vague "TODO" — acceptable. No "TBD"/"add validation"/"handle edge cases" elsewhere. Task 6 Step 4's bench-number `<before>` / `<after>` placeholders are filled at execution time from measurement, which is the only honest way to write that step.

**Type / name consistency:**
- `MainAxisDistribution` — used identically across Tasks 1, 2, 3, 4. ✓
- `mainDistribution` Field name — identical across Tasks 1–4 and the spec. ✓
- `mainDistributionPerParent` / `mainDistributionByParent` — Task 2 introduces `mainDistributionPerParent` (per-build Map inside `buildFlexGrammar`); Task 4 says fragment builders read from `output.mainDistributionByParent`. Discrepancy — pick one name. **Fix inline:** standardise on `mainDistributionByParent` (because it's a property of the `FlexGrammarOutput`, which carries the persistent state). Task 2's local map should populate `output.mainDistributionByParent` (or be promoted to that output field at the end of `buildFlexGrammar`). Updating my prose for Task 2 to use `mainDistributionByParent` everywhere.
- `emitMainDistribution` (Task 1) → `makeMainDistributionRule` factored out in Task 4. Spelled out in Task 4 Step 2's note. ✓
- `flexSibs` / `SizeInputs` / `DistributeSibling` — existing types in flex-grammar.ts, used consistently. ✓
- `parentNeedsFlexDistribution` (line 2088 of flex-grammar.ts) — referenced once in plan prose, code uses the function directly. ✓
- Test file path `packages/core/src/algorithm/spineless/flex-grammar.distribution.test.ts` — identical across Tasks 1–3. ✓

Fixing the `mainDistributionPerParent` / `mainDistributionByParent` inconsistency inline in this self-review by updating Task 2 to use `mainDistributionByParent` (as a field on `FlexGrammarOutput`, populated during build and consumed by fragment builders).
