# Launch copy — 2026-05-23 (for HN, X, Reddit)

Platform-specific text drawn from `2026-05-22-decisive-yoga-beat.md`. Each section is the canonical text you paste into that platform.

**Tone note:** This copy was rewritten 2026-05-23 to drop superlatives ("beats", "every", "decisive") in favor of qualified, methodology-led framing per HN community norms — see [Lucas Costa's HN-launch guide](https://www.lucasfcosta.com/blog/hn-launch) and the Bun launch criticism patterns (HN punishes vague comparative claims). The numbers are unchanged; the framing acknowledges that a 9-scenario hand-picked bench suite is what we measured, not a proof of universal superiority.

Numbers are from win32-x64, Node 22. If you want darwin/arm64 or linux numbers, regenerate with `pnpm bench` on the target platform first.

---

## Hacker News — "Show HN"

**Title** (under 80 chars, methodology-led, no superlatives):

```
Show HN: Pilates – pure-TypeScript flex layout for terminal UIs
```

**URL**: `https://github.com/pilatesjs/pilates`

**First comment** (post immediately after the submission so it ranks at the top):

```
Maintainer here. I've been building Pilates, a flex layout engine for terminal UIs in pure TypeScript. It's validated cell-for-cell against WASM Yoga (Ink's engine) across 33 oracle fixtures plus a structural-differential fuzzer.

The interesting result in this release: across the 9 benchmark scenarios I track, the pure-TS engine is now faster than WASM Yoga on each one — including the structural-mutation workload (append + remove a row per frame) Yoga led on by ~5× until last week. That flipped to a ~1.7× Pilates win (71µs vs 118µs median, win32-x64, Node 22).

Caveats up front:
- These are 9 hand-picked scenarios, not a proof for all flex workloads. Real consumer workloads will differ.
- The numbers are median over a ~5s tinybench window with bootstrap CI95. Win32-x64 here; macOS/Linux trend the same direction in spot checks but aren't the headline numbers.
- I built and benchmark the suite; treat it accordingly. Adversarial benchmarks especially welcome — I'd like to be wrong about a workload.

Two algorithmic insights did most of the work on the structural-mutation case:

1. The O(N) cumulative-sum main-axis position rule was 303 dependency edges per row in the stress fixture. Replaced with a linear recurrence (mainPos[N] = mainPos[N-1] + ...). Reverse-direction keeps the cumulative-sum fallback.

2. About half the grammar's input fields were inhabited only by their defaults (margin: 0, minWidth: 0, maxWidth: undefined). The grammar now folds them out as compile-time constants, shrinking each per-cell node from ~15 fields to ~7.

I considered a Rust + WASM port. The research call was: don't. Yoga's edge wasn't speed-of-arithmetic; it was algorithmic. The fix worked in TypeScript, and the "pure TS is competitive on this workload" framing is the actually-interesting result.

Public API didn't change. `calculateLayout()` is byte-identical to 1.x.

Validation: 1470 tests, structural-differential fuzzer at 3000 runs, the 33 Yoga-oracle fixtures, and a byte-identical cached-vs-cold differential mode at 833 runs. The fuzzer caught a real bug within hours of 2.0.0 publishing — `createStyleDirtier` had an over-strict assertion on folded-out nodes. 2.0.1 shipped same-day with a pinned regression test; 2.0.0 is deprecated on npm.

Reproduce: `git clone github.com/pilatesjs/pilates && pnpm install && pnpm bench` — about 5 minutes on a recent machine.

Happy to dig into the Spineless attribute-grammar runtime, the validation discipline, or specific benchmark methodology. Especially interested in workloads where this approach breaks down.
```

---

## X / Twitter — thread

**Tweet 1** (intent, not boast):

```
Shipped Pilates 2.0 — a pure-TypeScript flex layout engine for terminal UIs.

Across the 9 benchmark scenarios I track, it's now faster than WASM Yoga (Ink's engine) on each, including the structural-mutation workload Yoga led on by ~5× until last week.

🧵
```

**Tweet 2** (the numbers, qualified):

```
Median, win32-x64, Node 22, ~5s tinybench windows. 9-scenario hand-picked suite:

• tiny: 4.2×
• realistic: 2.7×
• stress: 3.2×
• big: 2.8×
• huge: 2.1×
• hot-relayout: 5.1×
• + boundaries: 4.9×
• text-mutation: 10×
• structural: 1.7× ⬅️ this was the remaining gap

Reproduce: `pnpm bench`.
```

**Tweet 3** (the algorithm story):

```
Two insights did the structural-mutation work.

1. The main-axis position rule was O(N) cumulative sum — 303 dep edges per row. Replaced with a linear recurrence (mainPos[N] = mainPos[N-1] + ...).

2. About half the grammar's input fields only ever held their defaults. Folded them out as constants.
```

**Tweet 4** (the Rust call):

```
I considered porting to Rust + WASM.

Research call: don't. Yoga's edge wasn't speed-of-arithmetic; it was algorithmic. The fix worked in TypeScript. "Pure TS is competitive with native code on this workload" was the actually-interesting result.
```

**Tweet 5** (validation, including the same-day 2.0.0 → 2.0.1):

```
Validated by 1470 tests, structural-differential fuzzer at 3000 runs, 33 Yoga-oracle fixtures, and byte-identical cached-vs-cold differential mode at 833 runs.

The fuzzer found a real bug in 2.0.0 within hours of publishing. 2.0.1 shipped same-day; 2.0.0 deprecated.
```

**Tweet 6** (the close):

```
Public API didn't change. calculateLayout() is byte-identical to 1.x; existing consumers benefit on upgrade.

Repo: https://github.com/pilatesjs/pilates
npm: @pilates/core@2.0.1

Adversarial benchmarks especially welcome.
```

---

## Reddit — r/typescript

**Title:**

```
[Show] Pilates – pure-TypeScript flex layout for terminal UIs
```

**Body:**

```
I've been building Pilates, a flex layout engine for terminal UIs in pure TypeScript. It's validated cell-for-cell against WASM Yoga (Ink's engine).

The 2.0 result: across the 9 benchmark scenarios I track, the pure-TS engine is faster than WASM Yoga on each, including the structural-mutation workload Yoga led on by ~5× until last week. That flipped to a ~1.7× Pilates win.

**Numbers** (median, win32-x64, Node 22):

| Scenario | Pilates | Yoga | Ratio |
|---|---:|---:|---:|
| tiny (10 nodes) | 4.5µs | 19.0µs | 4.2× |
| realistic (~100) | 121µs | 328µs | 2.7× |
| stress (~1000) | 601µs | 1.94ms | 3.2× |
| big (~5000) | 3.32ms | 9.17ms | 2.8× |
| huge (~10000) | 8.62ms | 18.5ms | 2.1× |
| hot-relayout | 16.3µs | 83.0µs | 5.1× |
| hot-relayout + boundaries | 15.8µs | 77.8µs | 4.9× |
| hot-relayout (text mutation) | 8.9µs | 90.6µs | 10× |
| hot-structural | 71.3µs | 118.3µs | 1.7× |

**Caveats:** 9 hand-picked scenarios, not a universal claim. Win32-x64 here; cross-platform spot checks trend the same direction but aren't the headline numbers. Reproduce with `pnpm bench`.

**Why pure TS:** Terminal UI is a curiously hostile workload for WASM. Trees are small (10–10k nodes) but updates are frequent. The crossing cost from JS into WASM dominates — Yoga's per-call kernel is a few microseconds, but `node.setWidth(N)` from JS to WASM is also a few microseconds. A pure-TS engine pays no crossing cost.

**What did the structural-mutation work:**

1. The O(N) cumulative-sum main-axis position rule was 303 dependency edges per row in the stress fixture. Replaced with a linear recurrence.
2. About half the grammar's input fields were inhabited only by their defaults (margin: 0, minWidth: 0). Folded them out as compile-time constants.

**Validation:** 1470 tests, structural-differential fuzzer at 3000 runs, Yoga oracle 33 fixtures, byte-identical cached-vs-cold differential mode at 833 runs. The fuzzer found a real bug in 2.0.0 within hours of publishing; 2.0.1 shipped same-day with the fix and a pinned regression test.

**API:** Public `calculateLayout()` is byte-identical to 1.x. Existing consumers benefit on upgrade.

Repo: https://github.com/pilatesjs/pilates
npm: https://www.npmjs.com/package/@pilates/core

Adversarial benchmarks especially welcome — would love to be wrong about a workload.
```

---

## Reddit — r/javascript

Same body as r/typescript above, but **title** swap:

```
[Show] Pilates – pure-JS flex layout for terminal UIs (faster than WASM Yoga in our 9-scenario benchmark suite)
```

(Slightly more direct in the title because r/javascript's culture rewards specificity over modesty; still qualifies with "in our 9-scenario benchmark suite".)

---

## Reddit — r/programming

**Title** (r/programming is anti-promotional; lead with the algorithmic write-up):

```
How we closed the last WASM-Yoga gap in a pure-TypeScript layout engine
```

**Body** (lead with method/insight, drop the announcement framing):

```
I've been working on a flex layout engine for terminal UIs in pure TypeScript. Last week I finished the work that closed the remaining gap against WASM Yoga (Facebook's flexbox engine, what Ink uses) on the structural-mutation workload — append + remove a row per frame on a 1k-node table. That went from ~5× slower than Yoga to ~1.7× faster, in pure TypeScript.

Posting because (1) the result was non-obvious — I considered a Rust port and the research said don't — and (2) the algorithmic insights are reusable.

**Two insights:**

1. The O(N) cumulative-sum main-axis position rule was 303 dependency edges per row in the stress fixture. Replaced with a linear recurrence (mainPos[N] = mainPos[N-1] + prev's main-size + prev's margin-end + my margin-start + gap). Reverse-direction keeps the cumulative-sum fallback because the recurrence depends on the prior element's resolved position.

2. About half the grammar's input fields were inhabited only by their defaults (margin: 0, minWidth: 0, maxWidth: undefined). Folding them out as compile-time constants shrank each per-cell node from ~15 fields to ~7. The classifier's nodeSig was extended to capture fold predicates so that mutating from default → non-default correctly triggers a rebuild.

**Numbers** across the 9-scenario suite (median, win32-x64, Node 22):

[same table as above]

**Why pure TS over Rust:** Yoga's edge wasn't speed-of-arithmetic; the per-pass kernel is fast and well-tuned. The edge was the structural-mutation algorithm — Yoga handled it natively, the pure-TS engine was redoing too much work per mutation. A Rust + WASM port would have inherited the same algorithmic shape and reached parity at best. The fix needed was algorithmic, and the algorithmic fix worked in TS.

**Validation:** Cell-for-cell against Yoga across 33 oracle fixtures; structural-differential fuzzer at 3000 runs; per-pass cached-vs-cold byte-identical differential mode at 833 runs. The fuzzer found a real bug in the first published version within hours; the fix shipped same-day with a pinned regression test. Theoretical analysis said the bug couldn't happen; the fuzzer disagreed; the fuzzer won.

Repo (MIT): https://github.com/pilatesjs/pilates
Design spec for this phase: linked in docs/superpowers/specs/

Caveats: 9 hand-picked scenarios, not a universal claim. Adversarial benchmarks welcome.
```

---

## Posting order

Suggested: HN first (single shot, can't repost), then X/Twitter thread, then Reddit (in order of strictness: r/typescript → r/javascript → r/programming). Space them by ~30 minutes so HN gets a fair window before the others compete for your attention.

## Defensive playbook for comments

Expect on HN:

- **"Have you benchmarked on Linux?"** — Fair. The README numbers are win32-x64; reproduce locally on the target platform if asked. Don't claim cross-platform parity you haven't measured.
- **"This is a hand-picked benchmark suite."** — Agree, you literally said so up front. Offer to add scenarios they suggest; the suite is open and reproducible.
- **"Why not Rust?"** — The research call is in the body. Link the announcement.
- **"What about Ink?"** — Pilates doesn't replace Ink for shipped apps. Position is unbundled-faster-engine for greenfield work; Ink stays a safe default for production CLIs today.
- **"How does Yoga's structural-mutation path actually work?"** — Honest answer: I haven't read Yoga's C++ in depth. Pilates was designed from the flex spec + Yoga's *behavior* (oracle fixtures), not its source.
- **"What's the memory cost?"** — `LayoutPool` grows unbounded; FinalizationRegistry-based recycling was tried and removed (caused 2× regression). For long-running processes that create many nodes over time, the pool's high-water mark is retained memory. Documented in the CHANGELOG.
- **"The Spineless engine sounds over-engineered for the problem."** — Maybe. The pure-TS competitive-with-WASM result is the proof it earned its weight; in retrospect, simpler approaches would have left structural mutation on the floor.

When criticized, agree first with the part that's right ("yes, 9 scenarios isn't the universe"), then add the qualifier. Don't get defensive on perf claims that aren't airtight.
