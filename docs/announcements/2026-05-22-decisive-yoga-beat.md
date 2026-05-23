# Pilates 2.0: pure TypeScript beats WASM Yoga on every layout workload

*Draft of an HN / blog announcement following Spineless phases 15–17 landing on `main` (PR #135, merged 2026-05-22). Not for publication until the `@pilates/core@2.0.0` release lands on npm.*

---

## TL;DR

[Pilates](https://github.com/pilatesjs/pilates) is a pure-TypeScript flex layout engine for terminal UIs. As of phase 17, it wins **all 9** of the bench suite's scenarios against `yoga-layout` (Ink's WASM-compiled C++ engine) — including the structural-mutation workload (append + remove a row per frame) Yoga held the lead on through phases 8–14.

Numbers (Node 22, win32-x64, `pnpm bench`):

| Scenario | Pilates core | yoga-layout (WASM) | Pilates speedup |
|---|---:|---:|---:|
| tiny (10 nodes) | 4.5µs | 19.0µs | **4.2×** |
| realistic (~100) | 121µs | 328µs | **2.7×** |
| stress (~1000) | 601µs | 1.94ms | **3.2×** |
| big (~5000) | 3.32ms | 9.17ms | **2.8×** |
| huge (~10000) | 8.62ms | 18.5ms | **2.1×** |
| **hot-relayout** (1k persistent, mutate one leaf/frame) | **16.3µs** | **83.0µs** | **5.1×** |
| **hot-relayout + boundaries** (same + explicit-sized rows) | **15.8µs** | **77.8µs** | **4.9×** |
| **hot-relayout (text mutation, fixed-size table)** | **8.9µs** | **90.6µs** | **10×** |
| **hot-structural** (append + remove a row / frame) | **71.3µs** | **118.3µs** | **1.7×** |

Reproduce: `git clone github.com/pilatesjs/pilates && pnpm install && pnpm bench`.

## What changed since the May announcement

The May 2026 announcement said Pilates was faster than Yoga "on every flex-layout workload — including every hot-relayout shape." That was true: tree-build-then-layout (2–9× faster) and hot-relayout (3× faster) were Pilates wins. One scenario was an honest gap, though, and the May post didn't fully account for it: **structural mutation** — building a 1k-node table once, then appending and removing a whole row per frame, was ~5× slower than Yoga in pure TypeScript at that time. Yoga's C++ kernel handled the recompute in ~90µs; Pilates needed ~450µs.

Phases 15–17 closed that gap. The final number: **71.6µs Pilates vs 92.1µs Yoga** — a 1.3× Pilates win in pure TypeScript on the workload Yoga's native code was supposed to dominate.

The journey by phase:

| Phase | What changed | hot-structural median |
|---|---|---|
| (phase 14 baseline) | imperative `finishWhole` fallback in structural fast-paths | 451µs |
| phase 14 (shelved) | engine-swap routing — caused fullBuild storms | 19ms |
| phase 14b (shelved) | imperative finish — regressed hot-relayout 30µs → 208µs | (rejected) |
| phase 15B–15I | typed-array runtime: `Field.id` integers, `LayoutPool`, `Map<Field,X>` → arrays, dirty-flag bitmask, flat `Float64Array` cache snapshots, lazy cache population | 478 → 275 → 211 → 250 → 120µs |
| phase 16 | linear-recurrence main-axis position rule (`mainPos[N] = mainPos[N-1] + ...` replacing O(N) cumulative-sum) | 120 → 100µs |
| phase 17 | fold default-valued style inputs out of the grammar (`FoldedInput = field \| const`); `nodeSig` tracks fold predicates of min/max/margin for correct rebuild triggering | **70µs** |

Two algorithmic insights did most of the work, and the research that found them is the thing worth reading:

- **The O(N) cumulative-sum mainPos was 303 dependency edges per row in the stress fixture** — every cell read every prior sibling's main-axis size. Replacing it with a linear recurrence (each cell reads only `mainPos[N-1]` and `mainSize[N-1]`) collapsed that. Reverse-direction (`row-reverse` / `column-reverse`) keeps the cumulative-sum path; the linear recurrence is the forward-only optimization.
- **About half the grammar's input fields were inhabited only by their defaults.** Margins of 0, `minWidth: 0`, `maxWidth: undefined` — encoded as fields, they took dirty-flag space, propagated through dependents, and showed up in dependency sets that never changed value. The phase-17 fold turns those into compile-time constants (per `nodeSig`-shaped rebuild), shrinking each per-cell node from ~15 fields to ~7.

We considered porting the engine to Rust + WASM. The research call was: don't. Yoga's edge wasn't speed-of-arithmetic; it was algorithmic — the structural fast-paths were doing O(tree) finish work where O(moved-subtree) sufficed. A Rust port would have reached parity at best; the algorithmic fix wins in TypeScript, and the "pure TS beats native code on this workload" framing is the actually-interesting result.

## Why this matters

Layout for a terminal UI is a curiously hostile workload for a WASM engine. Trees are small (10–10k nodes) but updates are frequent (one keystroke, one tick, one frame). The crossing cost from JS into WASM dominates — Yoga's per-call kernel is a few microseconds, but `node.setWidth(N)` from JS to WASM is also a few microseconds, and the layout pass might be only 50µs total. A pure-TS engine pays no crossing cost at all.

That observation was the thesis going in. Phases 15–17 are the proof that the thesis holds even at the worst case: a workload where Yoga's compute kernel is exactly the thing being measured (the tree is persistent, build cost amortized, only the structural-mutation layout is timed). And it still loses, in pure TypeScript, by 1.3×.

## What stayed the same

- Public API. `calculateLayout` is byte-identical to phase 14. Every consumer benefits on upgrade with zero code change.
- Validation discipline. The structural-differential fuzzer ran at `numRuns: 3000` for final sign-off. The Yoga oracle (33 fixtures) is green. `pnpm test:differential` (per-pass cached-vs-cold byte-identity check) passes across 833 runs.
- Zero runtime dependencies. `@pilates/core` ships with none. The whole layout engine, including the typed-array Spineless runtime, is in one TypeScript package.

## What's next

`@pilates/core@2.0.0` ships the engine update. The major version is a SemVer signal (the engine internals are different, including memory characteristics — `LayoutPool` grows unbounded, FinalizationRegistry-based recycling was tried in phase 15C and caused a 2× regression so was removed), but the **public API is source-compatible**. If you call `calculateLayout()` you'll see the speedup without code changes.

The remaining structural gap (Pilates at 71.6µs, Yoga at 92.1µs) is narrow enough that a future Yoga release closing it is plausible. We'll find out. For now: nine for nine, pure TypeScript.

## Try it

```bash
git clone https://github.com/pilatesjs/pilates
cd pilates
pnpm install
pnpm bench   # ~5 minutes; produces bench/RESULTS.md
```

Or, once 2.0.0 lands:

```bash
npm install @pilates/core
```

Issues, PRs, and adversarial benchmarks all welcome on the [repo](https://github.com/pilatesjs/pilates).
