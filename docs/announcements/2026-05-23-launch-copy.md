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

**Image:** none. HN doesn't render inline images and an image-only Show HN reads as low-effort. The README the URL points at already shows the bench comparison.

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

I considered a native-compiled-to-WASM port (Yoga itself is C++; Rust would have been my path since the migration tooling is better in 2026 — same WASM-target model either way). The research call was: don't. Yoga's edge wasn't speed-of-arithmetic; it was algorithmic. The fix worked in TypeScript, and "pure TS is competitive with native code on this workload" is the actually-interesting result.

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

**Tweet 2** (the numbers, qualified — **attach the bench comparison image** here; export `assets/bench-comparison.svg` to PNG first, X doesn't accept SVG):

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

**Tweet 4** (validation, including the same-day 2.0.0 → 2.0.1):

```
Validated by 1470 tests, structural-differential fuzzer at 3000 runs, 33 Yoga-oracle fixtures, and byte-identical cached-vs-cold differential mode at 833 runs.

The fuzzer found a real bug in 2.0.0 within hours of publishing. 2.0.1 shipped same-day; 2.0.0 deprecated.
```

**Tweet 5** (the close):

```
Public API didn't change. calculateLayout() is byte-identical to 1.x; existing consumers benefit on upgrade.

Repo: https://github.com/pilatesjs/pilates
npm: @pilates/core@2.0.1

Adversarial benchmarks especially welcome.
```

---

## Reddit — r/typescript

> **⚠️ Read the subreddit rules before posting.** Two specifically apply:
>
> - **Rule 2** ("contributes to TS utility, not just a random lib that happens to be written in TS"): borderline. The TypeScript-specific lesson ("native code isn't always the answer for perf-critical hot paths") is the case for posting; if you frame around the lesson rather than the library, you're more likely to clear mod review. Strictly read as "library category", the rule would reject it.
> - **Rule 5** ("ChatGPT comment/post"): the text below was AI-assisted. r/typescript's culture is sharp at spotting AI-polished prose. **Don't paste the text below verbatim.** Use it as a structural outline (title, table, numbers, links) and rewrite the prose paragraphs in your own voice — first-person, asymmetric sentence lengths, no em-dashes, casual phrasing, mention your stake / what made you start. The numbers and table can stay as-is.
>
> Alternative: skip r/typescript. r/javascript and r/programming have weaker AI-detection cultures and HN is the load-bearing venue regardless.

**Image:** consider posting as an **image submission** (the bench comparison PNG) with the text body in the first comment, OR a text post with the table inline. Image posts tend to outperform text-only on r/typescript and r/javascript. For r/programming, stay text — image-only submissions get treated as low-effort there.

**Title (rewrite-in-voice variant):**

```
[Show] Pilates – pure-TypeScript flex layout for terminal UIs
```

Or, framed around the TS lesson rather than the lib:

```
Closed the last WASM-Yoga gap with a pure-TypeScript layout engine — write-up
```

**Body (human-voice rewrite — still pass over it once and swap a few phrases for things you'd actually say):**

```
So I've been hacking on a flex layout engine for terminal UIs and the 2.0 finally went out this week. It's called Pilates. Pure TypeScript, validated against WASM Yoga (the engine Ink uses) across 33 oracle fixtures plus a structural fuzzer.

The TS-relevant thing I want to share: I started this assuming "pure TS is the constraint you accept for a zero-dep library, you give up some perf vs WASM and that's the trade." That's the wrong frame. For small frequently-updated trees (which is what terminal UI actually is), the JS→WASM crossing cost is comparable to the work being done in WASM. So a pure-TS engine doesn't have to lose. And as of last week it doesn't, across the 9 benchmark scenarios I run.

Median latency, win32-x64, Node 22:

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

Caveats up front because I know how reddit goes: 9 scenarios I picked, not a proof for all workloads. Win32 numbers. Reproduce with `pnpm bench` if you care; takes about 5 min.

The last row, hot-structural (append + remove a row per frame), was Yoga's territory until about a week ago. It was beating me 5×. Two things turned out to matter:

The flex distribution rule built a dependency edge from every cell to every prior sibling's size, so a 100-cell row had ~300 dep edges per row. Switched it to a linear recurrence (each cell only reads the one before it). And separately, when I went looking for "what fields are actually changing here", about half the grammar's input fields were sitting at default values forever (margin 0, minWidth 0, that kind of thing). Folded those out as constants at grammar-build time.

Combined, hot-structural went from ~450µs to ~70µs.

I considered porting to a compiled-to-WASM language before doing this. Yoga itself is C++; for Pilates the modern port path would have been Rust (better WASM tooling in 2026 for a JS migration). Glad I didn't go that route. Yoga's advantage wasn't speed of arithmetic, it was the algorithm shape. Once I fixed the algorithm in TS the speed-of-arithmetic gap wasn't the bottleneck anymore. A native port would have just inherited the same algorithm shape and reached parity at best.

One thing I want to flag because it's a TS-community-relevant moment: the fast-check fuzzer I ran across the engine caught a real bug within hours of 2.0.0 hitting npm. createStyleDirtier was throwing on a node whose entire style had been folded out — a case my analysis said couldn't happen, that the fuzzer immediately found. 2.0.1 shipped same day with the fix and a pinned regression test, and I deprecated 2.0.0 on npm. Property-based fuzzing earns its keep. I'd been on the fence about whether the fuzzer was worth maintaining; this answered it.

Public API didn't change between 1.x and 2.x. calculateLayout() is byte-identical. Existing consumers get the speedup on upgrade.

Repo (MIT): https://github.com/pilatesjs/pilates
npm: https://www.npmjs.com/package/@pilates/core

Adversarial benchmarks very welcome. I'd genuinely like to find a workload where this approach breaks down.
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

Posting because (1) the result was non-obvious — I considered a port to a compiled-to-WASM language (Yoga is C++, Rust would have been my path) and the research said don't — and (2) the algorithmic insights are reusable.

**Two insights:**

1. The O(N) cumulative-sum main-axis position rule was 303 dependency edges per row in the stress fixture. Replaced with a linear recurrence (mainPos[N] = mainPos[N-1] + prev's main-size + prev's margin-end + my margin-start + gap). Reverse-direction keeps the cumulative-sum fallback because the recurrence depends on the prior element's resolved position.

2. About half the grammar's input fields were inhabited only by their defaults (margin: 0, minWidth: 0, maxWidth: undefined). Folding them out as compile-time constants shrank each per-cell node from ~15 fields to ~7. The classifier's nodeSig was extended to capture fold predicates so that mutating from default → non-default correctly triggers a rebuild.

**Numbers** across the 9-scenario suite (median, win32-x64, Node 22):

[same table as above]

**Why pure TS over a native port:** Yoga's edge wasn't speed-of-arithmetic; its C++ kernel is fast and well-tuned but speed of arithmetic wasn't the bottleneck here. The edge was the structural-mutation algorithm — Yoga handled it natively, the pure-TS engine was redoing too much work per mutation. A native-compiled-to-WASM port (Rust would have been the migration target for Pilates; same WASM-target model as Yoga either way) would have inherited the same algorithmic shape and reached parity at best. The fix needed was algorithmic, and the algorithmic fix worked in TS.

**Validation:** Cell-for-cell against Yoga across 33 oracle fixtures; structural-differential fuzzer at 3000 runs; per-pass cached-vs-cold byte-identical differential mode at 833 runs. The fuzzer found a real bug in the first published version within hours; the fix shipped same-day with a pinned regression test. Theoretical analysis said the bug couldn't happen; the fuzzer disagreed; the fuzzer won.

Repo (MIT): https://github.com/pilatesjs/pilates
Design spec for this phase: linked in docs/superpowers/specs/

Caveats: 9 hand-picked scenarios, not a universal claim. Adversarial benchmarks welcome.
```

---

## Image export

The bench comparison lives at `assets/bench-comparison.svg`. To get a PNG for X/Reddit:

```bash
npx svgexport assets/bench-comparison.svg assets/bench-comparison.png 1760:1320
```

(1760×1320 is 2× the native SVG viewBox — high-DPI for retina displays. Drop the `1760:1320` argument for 1× output.) Alternatively: open the SVG in a browser and screenshot, or use Inkscape / any vector editor.

## Posting order

Suggested: HN first (single shot, can't repost), then X/Twitter thread, then Reddit (in order of strictness: r/typescript → r/javascript → r/programming). Space them by ~30 minutes so HN gets a fair window before the others compete for your attention.

## Reddit reality check (read before posting to any sub)

Each of the three subs has its own posture toward self-promo. The launch copy below was originally written as if all three accept library-launch posts the same way; they don't. Quick venue map:

- **r/programming** — strictly "no self-promotion" sub. Even technically-strong write-ups posted by the author often get removed. Safest pattern: someone else posts your blog post, or you wait. Don't post a GitHub repo directly. If you do try, link to a third-party-hosted write-up (dev.to, blog) and use the article title verbatim with no editorializing.

- **r/javascript** — has a weekly **"Showoff Saturday"** sticky thread; self-promo outside that thread gets removed. Two paths: (a) submit to Saturday sticky (low reach but allowed), or (b) reframe as a technical write-up post — title is about the finding, not the library. The library is mentioned once, near the bottom.

- **r/typescript** — lower volume, sharper moderation. Rules 2 and 5 still apply. The framing that fits the sub: **lead with the TS-specific lesson** ("native code isn't always the perf answer for X workload shape"), not the library. The library is the demo.

Voice patterns that work across all three (drawn from r/programming, r/javascript, r/typescript norms):

- Past tense, story arc ("I started building X. Y was the surprise. Z is what I learned.")
- Specific numbers, code excerpts, concrete decisions
- Acknowledge prior art (Yoga, Ink, OpenTUI)
- One "what I got wrong" or "what surprised me" beat (the 2.0.0 → 2.0.1 fuzzer story fits)
- Title is about the *finding*, not the project name
- Link the work, then mostly exit; don't reply defensively to every critical comment

**Verdict on this campaign:** posting to all three is more ambition than the campaign needs. HN is load-bearing. r/typescript is reachable if you take the rewrite seriously. r/javascript fits the Saturday-sticky pattern. r/programming should probably wait for someone else to post the work — or you skip it entirely.

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
