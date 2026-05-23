# Launch copy — 2026-05-23 (for HN, X, Reddit)

Platform-specific text drawn from `2026-05-22-decisive-yoga-beat.md`. Each section is the canonical text you paste into that platform. Numbers are from the win32-x64 bench run; if you want darwin/arm64 or linux numbers, regenerate with `pnpm bench` on the target platform first.

---

## Hacker News — "Show HN"

**Title** (under 80 chars, no editorialization):

```
Show HN: Pure-TypeScript flex layout engine beats WASM Yoga on every benchmark
```

**URL**: `https://github.com/pilatesjs/pilates`

**First comment** (post immediately after the submission so it ranks at the top):

```
Maintainer here. Pilates is a flex layout engine for terminal UIs in pure TypeScript, validated cell-for-cell against WASM Yoga (Ink's engine).

The interesting result in this release: pure TS now beats Yoga's WASM-compiled C++ on every benchmark in the suite — 1.7× to 10× depending on the workload, win32-x64, Node 22. The last gap was the structural-mutation workload (append + remove a row per frame), which Yoga held the lead on by ~5× until phases 15–17 landed last week. That flipped to a 1.7× Pilates win (~71µs vs ~118µs).

Two algorithmic insights did most of the work:

1. The O(N) cumulative-sum main-axis position rule was 303 dependency edges per row in the stress fixture. Replaced with a linear recurrence (mainPos[N] = mainPos[N-1] + ...).
2. About half the grammar's input fields were inhabited only by their defaults (margin: 0, minWidth: 0, maxWidth: undefined). The grammar now folds them out as compile-time constants, shrinking each per-cell node from ~15 fields to ~7.

We considered a Rust + WASM port. Research call was: don't. Yoga's edge wasn't speed-of-arithmetic; it was algorithmic. The fix wins in TypeScript and "pure TS beats native code on this workload" is the actually-interesting result.

Public API didn't change. `calculateLayout()` is byte-identical to 1.x — consumers benefit on upgrade with zero code changes.

Validated by: 1470 unit tests, structural-differential fuzzer at 3000 runs, Yoga oracle 33/33 fixtures, byte-identical cached-vs-cold differential mode at 833 runs. The fuzzer caught a real bug within hours of 2.0.0 publishing (`createStyleDirtier` over-strict assertion on folded-out nodes); 2.0.1 shipped same-day with the fix and a pinned regression test.

Reproduce: `git clone github.com/pilatesjs/pilates && pnpm install && pnpm bench` — 5 minutes on a recent machine.

Happy to dig into the algorithm, the Spineless attribute-grammar runtime, or the validation discipline. Adversarial benchmarks especially welcome.
```

---

## X / Twitter — thread

**Tweet 1** (the hook):

```
Pilates 2.0 is out: a pure-TypeScript flex layout engine that beats WASM Yoga (Ink's engine) on every benchmark.

Including the structural-mutation workload Yoga led on by 5× until last week.

In pure TS. No WASM port, no native bindings.

🧵
```

**Tweet 2** (the numbers):

```
9/9 Pilates wins vs yoga-layout (median, win32-x64, Node 22):

• tiny: 4.2×
• realistic: 2.7×
• stress: 3.2×
• big: 2.8×
• huge: 2.1×
• hot-relayout: 5.1×
• + boundaries: 4.9×
• text-mutation: 10×
• structural: 1.7× ⬅️ this was the last gap
```

**Tweet 3** (the algorithm story):

```
Two insights did the work.

1. The main-axis position rule was O(N) cumulative sum — 303 dep edges per row. Replaced with a linear recurrence (mainPos[N] = mainPos[N-1] + ...).

2. About half the grammar's input fields only ever held their defaults. Folded them out as constants.
```

**Tweet 4** (the Rust call):

```
We considered porting to Rust + WASM.

Research call: don't. Yoga's edge wasn't speed-of-arithmetic; it was algorithmic. The fix wins in TypeScript, and "pure TS beats native code on this workload" is the actually-interesting result.
```

**Tweet 5** (validation):

```
Validated by 1470 tests, structural-differential fuzzer at 3000 runs, 33 Yoga-oracle fixtures, and a byte-identical cached-vs-cold differential mode at 833 runs.

The fuzzer found a real bug in 2.0.0 within hours. 2.0.1 shipped same-day with the fix + pinned regression test.
```

**Tweet 6** (the close):

```
Public API didn't change. calculateLayout() is byte-identical to 1.x; existing consumers benefit on upgrade.

Repo: https://github.com/pilatesjs/pilates
npm: @pilates/core@2.0.1

Adversarial benchmarks welcome.
```

---

## Reddit — r/typescript

**Title:**

```
[Show] Pure-TypeScript flex layout engine that beats WASM Yoga on every benchmark
```

**Body:**

```
I've been working on Pilates, a flex layout engine for terminal UIs in pure TypeScript, validated cell-for-cell against WASM Yoga (Ink's engine).

The 2.0 milestone: pure TS now beats Yoga's WASM-compiled C++ on every benchmark in the suite, including the structural-mutation workload Yoga led on by ~5× until last week. That flipped to a 1.7× Pilates win.

**Numbers** (win32-x64, Node 22, median):

| Scenario | Pilates | Yoga | Ratio |
|---|---:|---:|---:|
| tiny (10 nodes) | 4.5µs | 19.0µs | **4.2×** |
| realistic (~100) | 121µs | 328µs | **2.7×** |
| stress (~1000) | 601µs | 1.94ms | **3.2×** |
| big (~5000) | 3.32ms | 9.17ms | **2.8×** |
| huge (~10000) | 8.62ms | 18.5ms | **2.1×** |
| hot-relayout | 16.3µs | 83.0µs | **5.1×** |
| hot-relayout + boundaries | 15.8µs | 77.8µs | **4.9×** |
| hot-relayout (text mutation) | 8.9µs | 90.6µs | **10×** |
| **hot-structural** | **71.3µs** | **118.3µs** | **1.7×** |

**Why pure TS:** Terminal UI is a curiously hostile workload for WASM. Trees are small (10–10k nodes) but updates are frequent. The crossing cost from JS into WASM dominates — Yoga's per-call kernel is a few microseconds, but `node.setWidth(N)` from JS to WASM is also a few microseconds. A pure-TS engine pays no crossing cost.

**What did the work:** Two insights from phases 15–17:

1. The O(N) cumulative-sum main-axis position rule was 303 dependency edges per row in the stress fixture. Replaced with a linear recurrence.
2. About half the grammar's input fields were inhabited only by their defaults (margin: 0, minWidth: 0). Folded them out as compile-time constants.

**Validation:** 1470 tests, structural-differential fuzzer at 3000 runs, Yoga oracle 33 fixtures, byte-identical cached-vs-cold differential mode at 833 runs. The fuzzer found a real bug in 2.0.0 within hours of publishing; 2.0.1 shipped same-day with the fix.

**API:** Public `calculateLayout()` is byte-identical to 1.x. Existing consumers benefit on upgrade.

Repo: https://github.com/pilatesjs/pilates
npm: https://www.npmjs.com/package/@pilates/core

Try it: `git clone github.com/pilatesjs/pilates && pnpm install && pnpm bench` — about 5 minutes.

Adversarial benchmarks especially welcome — would love to be wrong about a workload.
```

---

## Reddit — r/javascript

Same body as r/typescript above, but **title** swap:

```
[Show] Pure-JS flex layout engine that beats WASM Yoga on every benchmark
```

(s/TypeScript/JavaScript in title only; r/javascript audience cares less about the type system specifically and more about "JS beats native".)

---

## Reddit — r/programming

**Title** (r/programming is anti-promotional, so frame it as a technical write-up):

```
How we made a pure-TypeScript flex layout engine beat WASM Yoga on every benchmark
```

**Body** (same body as r/typescript above, but lead with the algorithm rather than the announcement):

Replace the opening paragraph with:

```
I've been working on a flex layout engine for terminal UIs and just finished the work that took it from "loses to Yoga on structural mutations" to "beats WASM Yoga on every benchmark, in pure TypeScript." Posting because the result was non-obvious (we considered a Rust port, the research said don't) and the algorithmic insights are reusable.
```

Then keep the rest identical.

---

## Posting order

Suggested: HN first (single shot, can't repost), then X/Twitter thread, then Reddit (in order of strictness: r/typescript → r/javascript → r/programming). Space them by ~30 minutes so HN gets a fair window before the others compete for your attention.

## What to watch for after posting

- HN comments asking about the Spineless engine internals — point at `docs/superpowers/specs/2026-05-21-phase15-decisive-yoga-beat.md` (the design spec) and the runtime-incremental fuzzer file.
- "Have you benchmarked on Linux?" — fair question, the README numbers are win32-x64. Reproduce locally if asked.
- "Why not Rust?" — the research call is in the announcement; link the draft.
- "What about Ink?" — Pilates doesn't replace Ink for shipped apps; positioning is unbundled-faster-engine for greenfield work.
