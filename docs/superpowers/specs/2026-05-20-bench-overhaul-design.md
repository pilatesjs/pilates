# Benchmark suite overhaul — professional rigor across every dimension

## Context

Pilates' current bench suite is **functional but minimal**: 9 scenarios in
`bench/scenarios/`, single-run mean latency via `tinybench`, output to a
markdown `bench/RESULTS.md`, and a CI budget gate via
`bench/check-budgets.ts`. It correctly drove the phases 8–13 perf arc —
each phase had a target scenario, a budget threshold, and a clear
pass/fail criterion. That worked.

But it's **not a professional bench suite**, and the project's perf
story has now reached the point where the bench itself is the limiting
factor on credibility:

- **No statistical depth.** Single-run mean only. No P50/P95/P99,
  no confidence interval, no variance characterization. A 5% regression
  is invisible; only ~5× cliffs are caught by budget thresholds.
- **Narrow workload coverage.** Only flex-start + nowrap + same tree
  shape variations. No `justify-content`, no `align-items`, no
  `flex-wrap`, no `aspect-ratio`, no measure functions at scale, no
  display-toggling, no animated values, no batched mutations.
- **No real-world replay.** All scenarios are synthetic micro-benchmarks.
  No measurement of an actual TUI workload (e.g. typing into a chat
  log, scrolling a table, paginating a list).
- **No memory dimension.** Heap allocation rate, GC pressure, and
  steady-state memory are unmeasured.
- **No cross-runtime.** Node-only. Bun and Deno are listed as
  supported runtimes in the README; we don't bench either.
- **No cross-platform consistency.** CI runs ubuntu/macos/windows but
  doesn't compare bench results across them or surface per-platform
  variance.
- **No historical tracking.** Every PR regenerates `RESULTS.md` from
  scratch; perf-over-time charts don't exist.
- **No baseline comparison engine besides Yoga.** Taffy
  (Rust→WASM, also flex) and Stretch would be informative third-party
  reference points.

After phase 13, Pilates' perf claims are strong: faster than Yoga on
every flex-layout workload, including hot-relayout. Defending those
claims at the scrutiny level they'll attract (HN, Twitter, OSS
peers) requires bench infrastructure that's **reproducible, statistically
rigorous, and broad in coverage**. This spec designs that overhaul.

## Goals

1. **Reproducibility.** Same code + same machine ± normal CI variance
   produces the same bench result within a documented confidence
   interval. Reproduction steps fit in one paste.
2. **Statistical rigor.** Every bench number reports median, P95,
   and standard error. Regression detection uses bootstrap CI95, not a
   single-point mean. Budget thresholds catch ≥10% regressions, not
   only 5× cliffs.
3. **Workload breadth.** Coverage spans the realistic axes a TUI
   author exercises: layout features (justify, align, wrap, absolute,
   aspect-ratio, measure functions), mutation patterns (single-value,
   structural, reorder, animated, batched), and tree shapes (deep,
   wide, mixed).
4. **Real-world replays.** Replay the layout calls a real `@pilates/react`
   app makes during a representative session (typing, scrolling,
   resizing). Numbers from these dominate the headline story; the
   micro-benchmarks become the "why is it fast" supporting evidence.
5. **Cross-environment.** Numbers from Node + Bun + Deno on ubuntu +
   macos + windows. CI publishes a per-environment matrix.
6. **Memory accounting.** Heap size and allocation rate measured
   per scenario; spelled out in the perf-claims story.
7. **Comparison breadth.** Third reference engine (Taffy) alongside
   Yoga. Validates that "Pilates beats Yoga" isn't "Pilates beats
   one specific WASM implementation".
8. **Historical tracking.** Bench results stored as machine-parseable
   JSON; a simple chart over the last N main commits surfaces drift.

## Non-goals (out of scope for this overhaul)

- Continuous bench against every PR (cost: CI minutes; benefit: low for
  a project this size). Bench runs on push-to-main + on request.
- Native browser-DOM comparison. Wrong axis — Pilates is not a CSS
  layout engine and the DOM has its own paint cost; the comparison
  isn't apples-to-apples.
- Multi-threaded bench (SharedArrayBuffer + workers). Pilates' design
  is single-threaded by intent; the workload SHAPE isn't representative
  of TUI usage.
- "Cooked" benchmarks (e.g. JetStream-style sub-test geometric means).
  We have a smallish number of scenarios; raw distribution per scenario
  is more informative than a single composite score.

## Architecture

### File layout

```
bench/
  README.md                     NEW — methodology, reproduction, expectations
  index.ts                      MODIFIED — orchestrator; subcommand dispatch
  harness/
    runner.ts                   NEW — multi-run loop, sample collection, stats
    stats.ts                    NEW — median / P95 / CI95 / outlier handling
    env.ts                      NEW — environment recorder (Node ver, OS, arch, CPU model, governor)
    reporter-markdown.ts        NEW — current Markdown output, refined
    reporter-json.ts            NEW — machine-parseable JSON, one file per run
    reporter-html.ts            NEW — single-page HTML dashboard with charts
  scenarios/
    [existing 9 scenarios kept] one-line cleanup pass; no shape change
    + 12-18 new scenarios       NEW — see "Workload coverage" below
    replays/                    NEW — real-world replay scenarios
      chat-log-typing.ts        Replay of a 30s session typing into a chat
      dashboard-scroll.ts       Replay of scrolling through a 1000-row table
      wizard-flow.ts            Replay of stepping through a 5-screen wizard
  comparison/
    yoga.ts                     EXISTING — extracted, shared
    taffy.ts                    NEW — Taffy-via-WASM adapter
  variance/
    measure-variance.ts         NEW — multi-run variance characterization tool
  history/
    [JSON files]                NEW — one per main commit; never deleted
    summary.ts                  NEW — load history, emit charts
  check-budgets.ts              MODIFIED — bootstrap CI95-based regression detection
  thresholds.json               MODIFIED — paired median + variance band per scenario
```

### Subcommands

`bench/index.ts` becomes a subcommand dispatch:

- `pnpm bench` — default, runs every scenario via `harness/runner.ts`,
  writes Markdown + JSON + HTML reports.
- `pnpm bench:variance` — runs every scenario N=20 times, reports the
  per-scenario distribution + CI95. Used once to calibrate budgets;
  re-run when CI runner changes.
- `pnpm bench:budgets` — existing, now uses CI95 regression detection
  against the last main commit's JSON, not a fixed `maxMeanMs` ceiling.
- `pnpm bench:filter <pattern>` — run only scenarios matching the
  pattern (developer iteration aid).
- `pnpm bench:replay` — runs only the real-world replays.
- `pnpm bench:engines <list>` — restrict which engines are measured
  (e.g. `--engines pilates,yoga` to skip Taffy on a quick run).

### Run-time methodology

For each `(scenario, engine)` pair:

1. **Cold prep.** Build any persistent state. Don't measure.
2. **Warmup.** 500ms of iterations, discarded. (Current `tinybench`
   default is 250ms; JIT-heavy paths benefit from longer warmup —
   measured during variance characterization.)
3. **Measurement.** 5 seconds or 100 iterations, whichever comes
   first. Sample = per-iteration nanosecond timing via
   `process.hrtime.bigint()`.
4. **Stats.** Compute median, P95, mean, stddev, CI95 (bootstrap with
   1000 resamples). Discard the top + bottom 5% before stats (light
   outlier trim — documented).
5. **Memory.** Force-GC (Node `--expose-gc`) between iterations only
   for the dedicated memory benchmarks (not the latency benchmarks —
   GC overhead distorts latency). Measure heap delta with
   `process.memoryUsage().heapUsed`.

### Environment recording

Every bench run produces an `environment` block in the JSON output:

```json
{
  "node": "v26.0.0",
  "platform": "darwin/arm64",
  "cpu": { "model": "Apple M2 Pro", "cores": 12 },
  "os": "Darwin Kernel 23.4.0",
  "git": { "sha": "abc1234", "branch": "main", "dirty": false },
  "timestamp": "2026-05-20T14:32:11Z",
  "pilates": { "core": "1.1.0", "render": "1.0.1", ... }
}
```

`RESULTS.md` header includes a one-line version of this. Historical
JSONs are keyed on `git.sha` so a regression bisect is straightforward.

### Statistical regression detection

`check-budgets.ts` is rewritten to compare the current run against the
**last main commit's JSON** (stored under `bench/history/`):

- For each scenario × engine, build CI95 intervals from the bootstrap
  samples of both runs.
- A regression is reported if the current CI95's lower bound is above
  the baseline CI95's upper bound × 1.10 (10% headroom on top of
  statistical separation). This is the "no overlap, ≥10% worse"
  criterion.
- Improvement of the same magnitude is logged but not failed.

`thresholds.json` becomes:

```json
{
  "hot-relayout-boundary": {
    "@pilates/core (layout)": {
      "macos-arm64": { "expectedMedianUs": 18.5, "ci95Us": [16, 22] },
      "linux-x64":   { "expectedMedianUs": 26.0, "ci95Us": [22, 32] },
      "win32-x64":   { "expectedMedianUs": 24.0, "ci95Us": [20, 30] }
    }
  }
}
```

Per-platform expectations. The variance characterization step
(Phase A below) populates this file. Regressions are detected against
the platform's own expectation, not a single global number — this
fixes the long-standing "CI runner variance" headache where a 5×
threshold has to cover the worst-case platform.

## Workload coverage

The 9 existing scenarios stay (cleanup-only). The new scenarios fill
gaps along three axes:

### A — Layout-feature coverage (8 new scenarios)

Each measures the cost of a specific feature at a representative tree
size (~100 nodes). The point is feature-cost calibration: how much
does adding `justifyContent: 'space-between'` cost? Each scenario
mutates one input and re-lays out 100 times.

1. **`feature-justify-variants`** — same tree, layout under each
   `justify-content` value (flex-start, center, end, space-between,
   space-around, space-evenly). Reports six numbers.
2. **`feature-align-variants`** — analogous for `align-items` /
   `align-content`.
3. **`feature-wrap`** — 50-cell row with `flex-wrap: wrap` at varying
   container widths. Tests the line-packer.
4. **`feature-aspect-ratio`** — explicit `aspectRatio` on nodes;
   measures the constraint-solver cost.
5. **`feature-absolute`** — tree with N absolute children; tests
   the absolute-positioning code path under structural mutation.
6. **`feature-display-toggle`** — 1k-node tree where 10% of nodes
   toggle `display: 'none'` per frame. Tests the v29 hidden-region
   handling.
7. **`feature-min-max-clamp`** — flex children with min/max
   constraints. Tests the freeze-loop in `distributeMainAxis`.
8. **`feature-measure-functions`** — 100-leaf tree where every leaf
   has a measure function (Pilates's text measurement). Stresses the
   measure-cache + the leaf-measurement call site.

### B — Mutation-pattern coverage (5 new scenarios)

Each takes the same tree shape (`stress`-sized, ~1000 nodes) and
applies a different mutation pattern per frame.

9. **`mutation-animated`** — single leaf's width oscillates
   sinusoidally over 60 frames. Tests the steady-state cost of
   continuous value mutation (the "60fps animation" pattern).
10. **`mutation-batch`** — 10 simultaneous style mutations across the
    tree per layout call. Tests whether the engine collapses batched
    mutations efficiently vs. doing 10× the work.
11. **`mutation-subtree-replace`** — remove a 100-node subtree and
    insert a different 100-node subtree per frame. Tests
    `detach + graft` interaction.
12. **`mutation-reorder-shuffle`** — randomly reorder a row of N
    children per frame. Tests `tryReorder` repeatedly.
13. **`mutation-scroll`** — emulates a scrollable list updating its
    visible viewport — mutate `display:none` on a sliding window of
    children. Tests the lazy-content pattern real TUIs use.

### C — Real-world replay (3 new scenarios)

Each is a recorded sequence of layout calls from an actual TUI
session. The recording format is a JSON array of `{ tree, op, value }`
entries; the replay tool drives them through `calculateLayout` and
measures.

14. **`replay-chat-log-typing`** — 30 seconds of typing into a chat
    UI with a scrollable history.
15. **`replay-dashboard-scroll`** — scrolling through `examples/react-build-dashboard`'s 100-row table.
16. **`replay-wizard-flow`** — stepping through a 5-screen wizard
    (`examples/react-wizard`).

Recordings are captured via a temporary `@pilates/core` debug hook
that logs every `calculateLayout` invocation; the resulting JSON is
committed alongside the scenario. Recordings are platform-independent
(they describe tree shapes + mutation ops, not timings).

### D — Memory-dimension scenarios (2 new scenarios)

Run under `node --expose-gc` and force-GC between iterations.

17. **`memory-cold-allocation`** — allocate + lay out a 1k-node tree;
    measure heap delta. Compared against Yoga's WASM heap.
18. **`memory-steady-state`** — 1000 iterations of the `hot-relayout`
    pattern; measure heap drift. Catches memory leaks.

## Comparison engines

### Existing — Yoga

Stays. Wrapped via `bench/comparison/yoga.ts`. Each scenario opts in
to "compare against Yoga" or not; e.g. `feature-aspect-ratio` makes
sense to compare; `memory-cold-allocation` doesn't (WASM heap is
different model).

### New — Taffy

Taffy ([github.com/DioxusLabs/taffy](https://github.com/DioxusLabs/taffy))
is a Rust flex+grid layout engine, compiled to WASM via
`taffy-layout` (or via direct wasm-bindgen from source). It's the
emergent second-place engine in the Rust TUI space (Dioxus, Bevy UI
both use it). Including it does two things:

1. **Validates the "JS↔WASM marshalling cost dominates" thesis.** If
   Pilates also beats Taffy by similar margins, the story isn't
   "Yoga-specific"; if Taffy is much closer to Pilates than Yoga is,
   we learn something about WASM-bridge implementations.
2. **Hedges the framing.** "Beats every comparable WASM flex engine,
   not just one" is a stronger claim.

Taffy doesn't support every feature Pilates does (its API is more
constrained); scenarios where Taffy doesn't have a matching API
just don't include a Taffy column. Honestly noted in `RESULTS.md`.

### Considered and rejected — Stretch

Stretch (the original Rust port of Yoga) is deprecated, low-activity,
and superseded by Taffy. Including it would add a column nobody
references.

## Phased rollout

Each phase is independently shippable. Phase A is the foundation;
B/C/D/E can proceed in any order once A lands.

### Phase A — Methodology foundation (~3 days)

The minimum that delivers professional-grade reliability. Everything
downstream depends on it.

- New `bench/harness/runner.ts` with the multi-run methodology above.
- `bench/harness/stats.ts` with bootstrap CI95.
- `bench/harness/env.ts` environment recording.
- JSON output alongside Markdown.
- `pnpm bench:variance` subcommand (one-shot, used for calibration).
- `check-budgets.ts` rewritten for CI95-based regression detection.
- `thresholds.json` migrated to per-platform expectations (data populated
  by the variance run).
- One CI workflow change: bench job stashes `bench/history/<sha>.json`
  on every push to main.

Existing 9 scenarios continue to pass; their numbers gain CI95
intervals and per-platform expectations.

Validation: re-run the bench three times in succession; the reported
CI95 of each scenario × engine should contain all three runs' medians.

### Phase B — Workload expansion (~5 days)

The 18 new scenarios listed under "Workload coverage". This is the
biggest user-visible jump in story quality — the perf claims become
defensible across the full feature surface, not just the cases that
happen to be benchmarked today.

- 8 layout-feature scenarios.
- 5 mutation-pattern scenarios.
- 3 real-world replay scenarios (includes capturing the replays from
  `examples/`).
- 2 memory-dimension scenarios.

Validation: every new scenario runs green at default thresholds;
`RESULTS.md` gains 18 new sections with sensible reproductions.

### Phase C — Cross-runtime (~2 days)

- Add Bun + Deno entries to the bench job in CI (matrix).
- Output: per-runtime columns in `RESULTS.md`'s key scenarios.
- Document any cases where Pilates' behaviour differs across runtimes
  (text measurement on Bun has a known divergence in the Unicode
  tables area — call it out, don't hide it).

Validation: CI produces three RESULTS.md variants per push.

### Phase D — Comparison expansion (~2 days)

- Add Taffy as a third reference engine in shared `bench/comparison/taffy.ts`.
- Audit each scenario for "Taffy-supported feature set"; opt in where
  it makes sense.
- Update `bench/RESULTS.md` prose to reflect "every comparable WASM
  flex engine" framing.

Validation: at least 6 scenarios have a Taffy column; numbers are
sensible (Taffy faster than Yoga at small trees, slower at huge —
the typical Rust-vs-C++ + binding-cost shape).

### Phase E — Reporting & history (~3 days)

- `bench/harness/reporter-html.ts` — single-page HTML dashboard
  generated from the JSON history. Charts: median over time per
  scenario, CI95 band, per-platform.
- `bench/history/summary.ts` — CLI that loads the history and prints
  a "what changed since last release" table.
- A GitHub Pages tab under `https://pilatesjs.github.io/pilates/bench/`
  publishing the dashboard (parallel to the typedoc site).

Validation: the dashboard loads without errors; charts render the
last ~20 main commits' numbers; a known regression (manufactured in a
test branch) shows up clearly.

### Phase F — Polish (~1 day)

- `bench/README.md` — methodology document for outside readers. Cites
  the design choices. Reproduces a known bench number with a paste-able
  recipe.
- Pin the bench machine recipe — preferred runner (a specific CI
  ubuntu image), expected variance numbers, "how to compare across
  hardware".
- Sanity check: every published Pilates perf claim references a
  scenario name + RESULTS.md row.

Validation: a fresh reader can clone, run, and reproduce the
headline number within their CI95 budget. (Project README's perf
table should already pass this test post-overhaul.)

## Validation invariants

The bench suite is correct iff:

1. **Reproducibility:** three sequential runs of `pnpm bench` produce
   medians whose CI95 intervals overlap. (Verified by `pnpm bench:variance`
   during Phase A.)
2. **Determinism of scenario shape:** each scenario file builds the
   same tree shape (verified by a structural hash) on every run. No
   non-determinism in tree construction.
3. **Cross-engine fairness:** each engine is given the same tree shape,
   the same mutations, the same warmup. No engine-specific shortcuts
   in the bench code.
4. **Honest reporting:** scenarios where Pilates loses are reported
   alongside scenarios where it wins. The `RESULTS.md` prose framing
   is technical, not promotional.
5. **No hidden state across scenarios:** each scenario module
   constructs its own persistent state at import time; no module-level
   coupling.
6. **Budget enforcement:** `pnpm -w run bench:budgets` fails CI on any
   regression beyond the CI95-based threshold (see Phase A).

## Workflow

Phases A → B → (C and D in parallel) → E → F. Each phase = one branch,
one PR, subagent-driven development matching phases 8–13. The
structural-fuzzer + value-differential analogues for the new scenarios
are unit tests at the harness level (e.g. "running scenario X N times
produces N samples").

Some scenarios will surface real perf bugs — Pilates' coverage of
edge cases under measure functions, wrap, and absolute positioning
hasn't been bench-tested before. Each such finding is its own
follow-up phase (likely a small one).

## Estimated outcomes

After all six phases ship, the perf-claims section of the project's
public-facing docs (README, STRATEGY, announcement) is backed by:

- 27 micro-scenarios + 3 real-world replays.
- Per-platform CI95 intervals; reproducible numbers ± documented variance.
- Three reference engines (Yoga, Taffy, plus Pilates direct
  Spineless where applicable).
- Three JS runtimes (Node, Bun, Deno).
- Memory + latency dimensions both measured.
- A historical chart of perf-over-time visible from the docs site.
- A bench README that a new reader can use to reproduce any
  headline number in under 5 minutes.

The marginal effort: ~16 working days across the six phases. Each
phase is independently valuable; even Phase A alone (the methodology
foundation) is a meaningful step up from the current "single-run
mean" state.

## Open questions for the user

1. **Phase ordering preference.** Phase A is the obvious first step;
   after that, what's the priority — Phase B (workload coverage,
   biggest story impact), Phase D (Taffy comparison, biggest
   credibility hedge), or Phase E (visible historical dashboard)?
2. **Scope discipline on real-world replays.** The 3 replays
   proposed are realistic but capturing them requires the
   `examples/` apps to be in a "session-able" state. If any of
   `chat-log` / `dashboard` / `wizard` doesn't have a recording-friendly
   structure, sub it out — there are other `examples/` to choose from.
3. **Taffy dependency.** Adding it as a devDependency is fine, but
   `taffy-layout` on npm is not the official source — we may need to
   either compile from the Taffy Rust source (extra setup) or
   accept a slightly-stale version from npm. Decide once Phase D
   starts.
4. **CI cost.** Phases C–E expand CI runtime materially. If that
   becomes painful, run the full matrix on push-to-main only, leave
   PR CI on the existing minimal matrix.

---

This spec is read-only at this stage — no source changes. The next
step is per-phase implementation plans (one per phase, written via
the writing-plans skill at execution time).
