# Layout Devtools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `@pilates/react`'s layout devtools — a `useLayoutProfiler()` hook and a `<LayoutDevtools>` overlay panel — the first consumer of the phase-9 `setLayoutProfiler` API.

**Architecture:** One new file `packages/react/src/layout-devtools.tsx` holds three exports: `sparkline` (a pure block-glyph helper), `useLayoutProfiler` (registers a `@pilates/core` profiler listener, accumulates traces into a ref, returns `{ last, history, totals }`), and `<LayoutDevtools>` (an absolutely-positioned overlay built on the hook). The hook does not self-trigger re-renders — it returns accumulated state on consumer-driven renders.

**Tech Stack:** TypeScript, React 19, `@pilates/react` (custom reconciler), `@pilates/core` (`setLayoutProfiler` / `LayoutTrace`), Vitest.

---

## File Structure

- `packages/react/src/layout-devtools.tsx` — **new** — `sparkline`, `useLayoutProfiler`, `LayoutDevtools`, and the `LayoutProfile` / `LayoutDevtoolsProps` types.
- `packages/react/src/layout-devtools.test.tsx` — **new** — tests for all three.
- `packages/react/src/index.ts` — **modify** — re-export the new public surface.
- `packages/react/src/index.test.ts` — **modify** — assert the new exports.
- `packages/react/README.md` — **modify** — a `## Layout devtools` section.
- `CHANGELOG.md` — **modify** — entry under `## Unreleased`.

The spec is `docs/superpowers/specs/2026-05-19-layout-devtools-design.md`. Work happens on branch `devtools-layout-profiler` (already created, spec already committed). One PR.

---

### Task 1: `sparkline` pure helper

**Files:**
- Create: `packages/react/src/layout-devtools.tsx`
- Test: `packages/react/src/layout-devtools.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `packages/react/src/layout-devtools.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { sparkline } from './layout-devtools.js';

describe('sparkline', () => {
  it('returns an empty string for an empty series', () => {
    expect(sparkline([])).toBe('');
  });

  it('returns all-low glyphs for an all-zero series', () => {
    expect(sparkline([0, 0, 0])).toBe('▁▁▁');
  });

  it('scales values to block glyphs against the series max', () => {
    // max 8 → 0 maps to the lowest glyph, 8 to the highest.
    expect(sparkline([0, 8])).toBe('▁█');
  });

  it('emits exactly one glyph per value', () => {
    expect(sparkline([1, 2, 3, 4, 5])).toHaveLength(5);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/react/src/layout-devtools.test.tsx`
Expected: FAIL — `layout-devtools.js` does not exist / `sparkline` is not exported.

- [ ] **Step 3: Write the minimal implementation**

Create `packages/react/src/layout-devtools.tsx`:

```tsx
/**
 * Layout devtools for `@pilates/react` — the first consumer of the
 * phase-9 `@pilates/core` observability API (`setLayoutProfiler`).
 *
 * `useLayoutProfiler()` is the data primitive; `<LayoutDevtools>` is a
 * ready-made overlay built on it. `sparkline` is the pure block-glyph
 * helper the panel renders its recent-cost row with.
 */

/** Block glyphs, lowest to highest, for `sparkline`. */
const SPARK_GLYPHS = '▁▂▃▄▅▆▇█';

/**
 * Map a series of non-negative numbers to a sparkline string — one
 * block glyph per value, scaled to the series maximum. An empty
 * series yields `''`; an all-zero series yields all-lowest glyphs.
 */
export function sparkline(values: readonly number[]): string {
  if (values.length === 0) return '';
  const max = Math.max(...values);
  if (max === 0) return SPARK_GLYPHS[0]!.repeat(values.length);
  const last = SPARK_GLYPHS.length - 1;
  return values
    .map((v) => SPARK_GLYPHS[Math.min(last, Math.max(0, Math.round((v / max) * last)))]!)
    .join('');
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/react/src/layout-devtools.test.tsx`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/layout-devtools.tsx packages/react/src/layout-devtools.test.tsx
git commit -m "$(cat <<'EOF'
feat(react): sparkline block-glyph helper for layout devtools

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `useLayoutProfiler` hook

**Files:**
- Modify: `packages/react/src/layout-devtools.tsx`
- Test: `packages/react/src/layout-devtools.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `packages/react/src/layout-devtools.test.tsx` (and add the imports at the top of the file — `mountWithInput`, `Box`, `Text`, and the hook):

```tsx
import { Box, Text } from './components.js';
import { mountWithInput } from './test-utils.js';
import { type LayoutProfile, useLayoutProfiler } from './layout-devtools.js';

const opts = { width: 30, height: 8 };

describe('useLayoutProfiler', () => {
  it('starts empty, then accumulates traces as the app relays out', () => {
    let captured: LayoutProfile | null = null;
    function App() {
      captured = useLayoutProfiler();
      return (
        <Box width={10} height={3}>
          <Text>hi</Text>
        </Box>
      );
    }
    const handle = mountWithInput(0, () => <App />, opts);
    // Mount render captured the profile before the post-commit effect
    // registered the profiler — so `last` is still null.
    expect(captured!.last).toBeNull();
    // Each setState commits, lays out, and fires the now-registered
    // profiler; the following render reads the accumulated ref.
    handle.setState(1);
    handle.setState(2);
    expect(captured!.last).not.toBeNull();
    const total =
      captured!.totals.build +
      captured!.totals.graft +
      captured!.totals.detach +
      captured!.totals.reorder +
      captured!.totals.incremental +
      captured!.totals.imperative;
    expect(total).toBeGreaterThanOrEqual(1);
    handle.unmount();
  });

  it('caps history at 60 traces', () => {
    let captured: LayoutProfile | null = null;
    function App() {
      captured = useLayoutProfiler();
      return (
        <Box width={10} height={3}>
          <Text>x</Text>
        </Box>
      );
    }
    const handle = mountWithInput(0, () => <App />, opts);
    for (let i = 1; i <= 70; i++) handle.setState(i);
    expect(captured!.history.length).toBeLessThanOrEqual(60);
    handle.unmount();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/react/src/layout-devtools.test.tsx`
Expected: FAIL — `useLayoutProfiler` / `LayoutProfile` are not exported.

- [ ] **Step 3: Write the minimal implementation**

Add to `packages/react/src/layout-devtools.tsx` — the imports at the top (below the doc comment) and the hook:

```tsx
import { type LayoutTrace, setLayoutProfiler } from '@pilates/core';
import { useEffect, useRef } from 'react';
```

```tsx
/** Max traces kept in the rolling history ring buffer. */
const HISTORY_LIMIT = 60;

/** Every engine path a `LayoutTrace` can report. */
type LayoutPath = LayoutTrace['path'];

/** The data `useLayoutProfiler` returns. */
export interface LayoutProfile {
  /** The most recent `LayoutTrace`, or `null` before the first captured layout. */
  last: LayoutTrace | null;
  /** Recent traces, oldest first, capped at 60. */
  history: readonly LayoutTrace[];
  /** Cumulative count of each engine path since the hook mounted. */
  totals: Readonly<Record<LayoutPath, number>>;
}

function emptyTotals(): Record<LayoutPath, number> {
  return { build: 0, graft: 0, detach: 0, reorder: 0, incremental: 0, imperative: 0 };
}

interface ProfileState {
  last: LayoutTrace | null;
  history: LayoutTrace[];
  totals: Record<LayoutPath, number>;
}

/**
 * Observe the Spineless layout engine: returns the latest `LayoutTrace`,
 * a bounded recent history, and cumulative per-path totals.
 *
 * The hook registers a `@pilates/core` profiler listener on mount and
 * clears it on unmount. `setLayoutProfiler` is a single global slot —
 * use **one** `useLayoutProfiler` (or one `<LayoutDevtools>`) per app.
 *
 * The hook does NOT self-trigger re-renders: a profiler's state changes
 * on every layout, so a post-commit force would loop forever. It
 * returns the accumulated state on every render the consumer drives;
 * the panel is thus one completed layout behind — imperceptible in an
 * interactive app, which re-renders to produce the layouts profiled.
 */
export function useLayoutProfiler(): LayoutProfile {
  // Mutable accumulator written by the listener — which fires inside
  // `calculateLayout`, mid-commit, where a React update is unsafe.
  const stateRef = useRef<ProfileState>({
    last: null,
    history: [],
    totals: emptyTotals(),
  });

  useEffect(() => {
    setLayoutProfiler((_root, trace) => {
      const s = stateRef.current;
      s.last = trace;
      s.history.push(trace);
      if (s.history.length > HISTORY_LIMIT) s.history.shift();
      s.totals[trace.path]++;
    });
    return () => setLayoutProfiler(null);
  }, []);

  const s = stateRef.current;
  // Fresh copies so a consumer comparing by identity sees each render.
  return { last: s.last, history: [...s.history], totals: { ...s.totals } };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/react/src/layout-devtools.test.tsx`
Expected: PASS — 6 tests (4 sparkline + 2 hook).

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/layout-devtools.tsx packages/react/src/layout-devtools.test.tsx
git commit -m "$(cat <<'EOF'
feat(react): useLayoutProfiler hook

Registers a @pilates/core profiler listener, accumulates LayoutTraces
into a ref, and returns { last, history (ring buffer, 60), totals }.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `<LayoutDevtools>` overlay component

**Files:**
- Modify: `packages/react/src/layout-devtools.tsx`
- Test: `packages/react/src/layout-devtools.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `packages/react/src/layout-devtools.test.tsx`. Add `stripAnsi` to the `@pilates/core` import already present (`import { stripAnsi } from '@pilates/core';` — a separate import line is fine) and `LayoutDevtools` to the `./layout-devtools.js` import:

```tsx
import { stripAnsi } from '@pilates/core';
import { LayoutDevtools } from './layout-devtools.js';

const panelOpts = { width: 40, height: 14 };

describe('LayoutDevtools', () => {
  it('renders an overlay panel showing the latest engine path', () => {
    function App() {
      return (
        <Box width={40} height={14}>
          <Text>app body</Text>
          <LayoutDevtools />
        </Box>
      );
    }
    const handle = mountWithInput(0, () => <App />, panelOpts);
    handle.setState(1);
    handle.setState(2);
    const out = stripAnsi(handle.allWrites());
    expect(out).toContain('last:');
    expect(out).toMatch(/incremental|build|imperative/);
    handle.unmount();
  });

  it('hideSparkline drops the cost row', () => {
    function App({ hide }: { hide: boolean }) {
      return (
        <Box width={40} height={14}>
          <LayoutDevtools hideSparkline={hide} />
        </Box>
      );
    }
    const shown = mountWithInput(0, () => <App hide={false} />, panelOpts);
    shown.setState(1);
    expect(stripAnsi(shown.allWrites())).toContain('cost');
    shown.unmount();

    const hidden = mountWithInput(0, () => <App hide={true} />, panelOpts);
    hidden.setState(1);
    expect(stripAnsi(hidden.allWrites())).not.toContain('cost');
    hidden.unmount();
  });

  it('renders for a non-default placement', () => {
    function App() {
      return (
        <Box width={40} height={14}>
          <LayoutDevtools placement="bottom-left" />
        </Box>
      );
    }
    const handle = mountWithInput(0, () => <App />, panelOpts);
    handle.setState(1);
    expect(stripAnsi(handle.allWrites())).toContain('last:');
    handle.unmount();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/react/src/layout-devtools.test.tsx`
Expected: FAIL — `LayoutDevtools` is not exported.

- [ ] **Step 3: Write the minimal implementation**

Add to `packages/react/src/layout-devtools.tsx`. Extend the `react` import to include `JSX`, and add a `components.js` import:

```tsx
import { type JSX, useEffect, useRef } from 'react';
import { Box, Text } from './components.js';
```

Then add, at the end of the file:

```tsx
/** Engine paths in panel display order. */
const PATHS: readonly LayoutPath[] = [
  'build',
  'graft',
  'detach',
  'reorder',
  'incremental',
  'imperative',
];

/** Props for `<LayoutDevtools>`. */
export interface LayoutDevtoolsProps {
  /** Corner the overlay anchors to. Default `'top-right'`. */
  placement?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  /** Hide the recent-cost sparkline row. Default `false`. */
  hideSparkline?: boolean;
}

function anchorPosition(
  placement: NonNullable<LayoutDevtoolsProps['placement']>,
): { top?: number; right?: number; bottom?: number; left?: number } {
  switch (placement) {
    case 'top-left':
      return { top: 0, left: 0 };
    case 'top-right':
      return { top: 0, right: 0 };
    case 'bottom-left':
      return { bottom: 0, left: 0 };
    case 'bottom-right':
      return { bottom: 0, right: 0 };
  }
}

/**
 * A live layout-profiler overlay panel. Renders as an
 * absolutely-positioned `<Box>` anchored to a corner — it does not
 * reflow the host app. Shows the latest `LayoutTrace`, a recent-cost
 * sparkline, and cumulative per-path totals.
 *
 * Caveat: being in the host's render tree, the panel's own nodes are
 * counted in the traces it reports — absolute counts run slightly
 * high. The `path` classification is unaffected.
 */
export function LayoutDevtools(props: LayoutDevtoolsProps): JSX.Element {
  const { placement = 'top-right', hideSparkline = false } = props;
  const { last, history, totals } = useLayoutProfiler();

  return (
    <Box
      positionType="absolute"
      position={anchorPosition(placement)}
      flexDirection="column"
      border="single"
      title="layout"
    >
      <Text>{last ? `last: ${last.path}` : 'last: —'}</Text>
      <Text>
        {last ? `recomp ${last.fieldsRecomputed} chg ${last.fieldsChanged}` : 'recomp — chg —'}
      </Text>
      {hideSparkline ? null : (
        <Text>{`cost ${sparkline(history.map((t) => t.fieldsRecomputed))}`}</Text>
      )}
      {PATHS.map((p) => (
        <Text key={p}>{`${p.padEnd(11)} ${totals[p]}`}</Text>
      ))}
    </Box>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/react/src/layout-devtools.test.tsx`
Expected: PASS — 9 tests (4 sparkline + 2 hook + 3 component).

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/layout-devtools.tsx packages/react/src/layout-devtools.test.tsx
git commit -m "$(cat <<'EOF'
feat(react): LayoutDevtools overlay panel

An absolutely-positioned overlay built on useLayoutProfiler — latest
trace, per-path totals, and a recent-cost sparkline.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Public exports, README, and CHANGELOG

**Files:**
- Modify: `packages/react/src/index.ts`
- Modify: `packages/react/src/index.test.ts:25` (append a new `describe`)
- Modify: `packages/react/README.md`
- Modify: `CHANGELOG.md:7-9` (replace the `## Unreleased` placeholder text)

- [ ] **Step 1: Write the failing test**

Append to `packages/react/src/index.test.ts`:

```tsx
describe('@pilates/react public surface — layout devtools', () => {
  it('re-exports useLayoutProfiler, LayoutDevtools, and sparkline', () => {
    expect(typeof Pilates.useLayoutProfiler).toBe('function');
    expect(typeof Pilates.LayoutDevtools).toBe('function');
    expect(typeof Pilates.sparkline).toBe('function');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/react/src/index.test.ts`
Expected: FAIL — `Pilates.useLayoutProfiler` is `undefined` (`typeof` is `'undefined'`, not `'function'`).

- [ ] **Step 3: Add the exports**

Append to `packages/react/src/index.ts`:

```ts
// Layout devtools — consumer of the @pilates/core phase-9 profiler API.
export { LayoutDevtools, sparkline, useLayoutProfiler } from './layout-devtools.js';
export type { LayoutDevtoolsProps, LayoutProfile } from './layout-devtools.js';
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/react/src/index.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the README section**

In `packages/react/README.md`, after the `## useBoxMetrics` section (it ends just before `## Theming`), insert:

```markdown
## Layout devtools

`useLayoutProfiler()` and `<LayoutDevtools>` surface what the Spineless
incremental layout engine is doing, frame by frame.

```tsx
import { LayoutDevtools } from '@pilates/react';

function App() {
  return (
    <Box width="auto" height="auto">
      {/* your UI */}
      <LayoutDevtools placement="top-right" />
    </Box>
  );
}
```

`<LayoutDevtools>` is an absolutely-positioned overlay — it does not
reflow your app. It shows the latest layout's engine path
(`incremental` / `build` / `graft` / `detach` / `reorder` /
`imperative`), recompute counts, a recent-cost sparkline, and
cumulative per-path totals. Props: `placement`
(`'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'`, default
`'top-right'`) and `hideSparkline`.

For custom UI, `useLayoutProfiler()` returns `{ last, history, totals }`
directly — `last` is the most recent `LayoutTrace`, `history` a
bounded ring buffer (60), `totals` cumulative per-path counts.

**Caveat:** the panel is part of your render tree, so its own nodes
are counted in the traces it reports — absolute counts run slightly
high. The `path` classification (did this frame relayout
incrementally, or rebuild?) is unaffected. The panel reflects the most
recent *completed* layout, one frame behind.

Use **one** `useLayoutProfiler` / `<LayoutDevtools>` per app —
`@pilates/core`'s profiler is a single global slot.
```

- [ ] **Step 6: Update the CHANGELOG**

In `CHANGELOG.md`, replace the `## Unreleased` body (currently the two lines `Nothing pending. Next changes will accumulate here before the next` / `package version cut.`) with:

```markdown
## Unreleased

### Added — `@pilates/react`

- `useLayoutProfiler()` hook and `<LayoutDevtools>` overlay panel — the
  first consumer of `@pilates/core`'s layout-profiler API. The hook
  returns the latest `LayoutTrace`, a bounded history, and cumulative
  per-path totals; the panel renders them as an absolutely-positioned
  in-TUI overlay. `sparkline` block-glyph helper exported alongside.
```

- [ ] **Step 7: Verify the whole workspace is green**

Run: `pnpm lint`
Expected: PASS — `Checked NNN files`, no errors.

Run: `pnpm typecheck`
Expected: PASS — every package `Done`.

Run: `npx vitest run packages/react`
Expected: PASS — all `@pilates/react` suites green, including the 9 new `layout-devtools` tests and the new `index.test.ts` case.

If `pnpm lint` reports a formatting diff, run `npx biome check --write packages/react/src/layout-devtools.tsx packages/react/src/layout-devtools.test.tsx packages/react/src/index.ts` and re-run the three commands.

- [ ] **Step 8: Commit**

```bash
git add packages/react/src/index.ts packages/react/src/index.test.ts packages/react/README.md CHANGELOG.md
git commit -m "$(cat <<'EOF'
feat(react): export layout devtools + README + CHANGELOG

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**Spec coverage:**
- `useLayoutProfiler()` returning `{ last, history, totals }`, ring buffer 60, registers/clears the global profiler, no self-re-render — Task 2. ✓
- `<LayoutDevtools>` absolute overlay, `placement` + `hideSparkline`, latest trace + totals + sparkline, no node inspector — Task 3. ✓
- Observer effect: `position: absolute` (Task 3), counts-inclusive caveat documented (README, Task 4 Step 5; component JSDoc, Task 3). ✓
- `sparkline` helper — Task 1, exported Task 4. ✓
- New file `layout-devtools.tsx` + test, `index.ts` / `index.test.ts` / README / CHANGELOG edits — Tasks 1–4. ✓
- One branch / one PR — `devtools-layout-profiler`. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code; every command has an expected result. ✓

**Type consistency:** `LayoutProfile` (`last` / `history` / `totals`), `LayoutPath`, `ProfileState`, `LayoutDevtoolsProps` (`placement` / `hideSparkline`), `sparkline(values)` — names identical across Tasks 1–4. The component reads `last.fieldsRecomputed` / `last.fieldsChanged` / `last.path` and `t.fieldsRecomputed` — all real `LayoutTrace` fields (phase-9 `@pilates/core`). ✓
