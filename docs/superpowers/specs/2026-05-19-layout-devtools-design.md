# Layout devtools — `useLayoutProfiler` + `<LayoutDevtools>`

## Problem

Phase 9 gave `@pilates/core` an observability API — `setLayoutProfiler`
(a per-`calculateLayout` `LayoutTrace`) and `inspectLayout` (a static
subtree dump). Nothing consumes it. A `@pilates/react` developer has
no way to *see*, while their app runs, whether the incremental engine
is doing its job: did this frame relayout incrementally, or rebuild?
how much did it recompute? is some interaction quietly triggering a
full rebuild every frame?

This is the first consumer of the phase-9 API: a React hook plus a
ready-made in-TUI overlay panel.

## Approach

Two pieces, in one new file `packages/react/src/layout-devtools.tsx`,
both exported from `@pilates/react`'s `index.ts`:

- **`useLayoutProfiler()`** — the data primitive. Registers a profiler
  listener, accumulates traces, and returns `{ last, history,
  totals }`. This is the real API; anyone can build their own UI on
  it, log traces, or pipe them elsewhere.
- **`<LayoutDevtools>`** — a ready-made overlay built on the hook.
  One opt-in component; convenience, not contract.

Both are already tree-shakeable: separate named exports, the package
is `sideEffects: false`, so a production app that imports neither
carries no devtools code.

### The observer effect

An overlay rendered inside the same `@pilates/react` app shares the
one reconciler render tree and the one `calculateLayout` root. Two
consequences, handled differently:

- **Flow perturbation** — a normal in-flow panel would reflow the
  app's content. The panel is therefore **`position: absolute`** — an
  overlay never participates in its host's flex flow.
- **Measurement perturbation** — the panel's own nodes are in the
  tree, so they are counted in the `LayoutTrace` the panel displays.
  Eliminating this would need a separate render process — out of
  scope for v1. Instead: it is **documented** (JSDoc + README), the
  panel's dynamic node count is kept minimal, and we rely on the
  **`path` field staying reliable** — whether a frame took
  `incremental` vs `build` is decided by the app's mutation, not the
  near-static panel. The absolute counts run slightly high; the
  qualitative "am I incremental?" answer does not.

## `useLayoutProfiler()`

```ts
interface LayoutProfile {
  /** The most recent LayoutTrace, or null before the first layout. */
  last: LayoutTrace | null;
  /** Recent traces, oldest first, capped at HISTORY_LIMIT (60). */
  history: readonly LayoutTrace[];
  /** Cumulative count of each engine path since the hook mounted. */
  totals: Readonly<Record<LayoutTrace['path'], number>>;
}

function useLayoutProfiler(): LayoutProfile;
```

- On mount the hook calls `setLayoutProfiler(listener)`; on unmount,
  `setLayoutProfiler(null)`. `setLayoutProfiler` is a single-slot
  global — **one `useLayoutProfiler` per app** (documented). A second
  mounted hook would displace the first; the devtools panel is a
  singleton, so this is a non-issue in practice.
- The listener accumulates each `LayoutTrace` into a **bounded ring
  buffer** (`HISTORY_LIMIT = 60` — no unbounded growth) held in a
  `useRef`, and bumps the per-`path` totals.
- The listener fires *inside* `calculateLayout`, mid-commit, where a
  React render must not be triggered. It writes the trace to a
  `useRef`-held accumulator and nothing else. The hook does **not**
  self-trigger re-renders: a profiler's state (`totals`, `history`)
  changes on *every* layout, so a post-commit force — which
  `useBoxMetrics` relies on, loop-broken by layout *stabilising* —
  would never stabilise here and would loop forever. Instead the hook
  returns the accumulated state on every render the consumer drives.
  `<LayoutDevtools>` re-renders whenever its host subtree re-renders
  (which is what produces the layouts being profiled), so in an
  interactive app the panel is effectively live — showing the most
  recent completed layout, one frame behind; an idle app produces no
  layouts to miss. This one-frame lag is documented as the hook's
  contract.

## `<LayoutDevtools>`

```ts
interface LayoutDevtoolsProps {
  /** Corner the overlay anchors to. Default 'top-right'. */
  placement?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  /** Hide the recent-cost sparkline. Default false. */
  hideSparkline?: boolean;
}

function LayoutDevtools(props: LayoutDevtoolsProps): ReactElement;
```

An absolutely-positioned `<Box>` overlay, anchored to a corner via
`position: absolute` + the corresponding edge offsets. It calls
`useLayoutProfiler()` and renders:

- **Latest trace** — `path` and the per-call counts (`dirtyNodes`,
  `fieldsRecomputed`, `fieldsChanged`, `movedSubtrees`).
- **Per-path totals** — `build` / `graft` / `detach` / `reorder` /
  `incremental` / `imperative` counts since mount.
- **Recent-cost sparkline** — the `history`'s `fieldsRecomputed`
  values mapped to block glyphs (`▁▂▃▄▅▆▇█`), so a frame that
  rebuilt when it should have stayed incremental stands out as a
  spike. Suppressed by `hideSparkline`.

The panel is a *profiler* — performance over time. It deliberately
does **not** embed a node inspector; inspecting a subtree's computed
boxes is a separate concern that `inspectLayout` already serves.
Merging the two would make a worse version of each.

## Files

- **New** `packages/react/src/layout-devtools.tsx` — the hook and the
  component (one file, one concern).
- **New** `packages/react/src/layout-devtools.test.tsx`.
- **Modified** `packages/react/src/index.ts` — export `useLayoutProfiler`,
  `LayoutDevtools`, `sparkline` (the small pure block-glyph helper the
  panel uses — directly unit-testable and a reasonable standalone
  utility), and the `LayoutProfile` / `LayoutDevtoolsProps` types.
- **Modified** `packages/react/README.md` — a "Layout devtools"
  section, including the panel-inclusive-counts caveat.
- **Modified** root `CHANGELOG.md` — under `## Unreleased`.

## Testing

`layout-devtools.test.tsx`, using `@pilates/react`'s existing
`test-utils` (`mountWithInput`):

- `useLayoutProfiler` — mounting registers a profiler; a re-render /
  mutation produces a `last` trace; `totals` accumulate per path;
  `history` is bounded at `HISTORY_LIMIT`; unmount clears the global
  profiler (`setLayoutProfiler(null)`).
- `<LayoutDevtools>` — renders an absolutely-positioned overlay whose
  text contains the latest path and counts; `placement` moves the
  anchor; `hideSparkline` drops the sparkline row.
- Test isolation — every test unmounts (clearing the global
  profiler); a differential-mode guard is unnecessary since the
  devtools live in `@pilates/react`, not the core layout path.

## Validation

Full workspace suite green (`pnpm test`), `pnpm typecheck` and
`pnpm lint` clean. Ships as one branch / one PR. Additive public
surface on `@pilates/react` — lands in CHANGELOG `## Unreleased`.
