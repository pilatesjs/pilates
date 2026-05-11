# Pilates: a pure-TypeScript flex layout engine that beats WASM Yoga at terminal-UI workloads

*Draft of an HN / blog announcement following the Phase 3 perf-hardening merge. Not for publication until the maintainer reviews and the `@pilates/core` 1.0.0 promotion lands.*

---

## TL;DR

[Pilates](https://github.com/pilatesjs/pilates) is a five-package layout-and-render stack for terminal UIs. The headline change in this week's release: the layout engine is now faster than WASM Yoga (Ink's engine) on every benchmarked workload, including the long-lived-tree-with-hot-relayout case Yoga had historically won on.

Numbers:

| Scenario | Pilates core | yoga-layout (WASM) | Pilates speedup |
|---|---:|---:|---:|
| 10-node tree | 1.5µs | 15.1µs | **10×** |
| ~100-node tree | 29µs | 263µs | **9×** |
| ~1000-node tree | 0.17ms | 1.52ms | **9×** |
| ~5000-node tree | 0.94ms | 7.26ms | **8×** |
| ~10000-node tree | 2.16ms | 14.6ms | **7×** |
| 1k-node persistent tree, mutate one leaf/frame | 129µs | 56µs | Yoga wins ~2.3× |
| **Same + explicit-sized container rows** | **7.1µs** | **51µs** | **7×** |

Reproduce: `git clone github.com/pilatesjs/pilates && pnpm install && pnpm bench`.

## Why this matters

Terminal UI in JavaScript means [Ink](https://github.com/vadimdemedes/ink). Ink uses [Yoga](https://github.com/facebook/yoga) (Facebook's flex layout engine, compiled to WASM) for layout and pairs it with a React reconciler. The split is invisible from the consumer side: you get them together. Yoga's compute kernel is genuinely fast — it's hand-tuned C++ — but every `node.setWidth(N)` crosses the JS↔WASM boundary, and that marshalling cost dominates Yoga's compute advantage at TUI tree sizes (10–10000 nodes).

Pilates is a from-scratch flex layout engine in pure TypeScript, validated cell-for-cell against Yoga across 33 oracle fixtures plus a 500-runs-per-CI property fuzzer. No WASM, no JS↔WASM bridge, zero runtime dependencies.

For tree-build-then-layout (the natural shape of a TUI redrawing every frame from declarative state), Pilates has been faster than Yoga since day one: 7–12× across all scenarios. The one workload Yoga still won was *long-lived trees with hot relayouts* — build once, mutate one leaf, relayout, repeat. The build cost amortizes, only the layout pass is measured, and Yoga's compute speed shows.

This week's Phase 3 release adds Flutter-style **relayout boundaries**: a node with explicit `width` AND `height` (the idiomatic TUI pattern, e.g. fixed-height rows or sidebars) acts as a barrier that stops dirty propagation. A leaf mutation inside such a container dirties the container but doesn't propagate to root, so Pilates' root layout cache stays valid and the next layout pass restores most of the tree from cache instead of re-running flex. Combined with the `_hasDirtyDescendant` optimization (so the cache-hit path skips clean subtrees in O(dirty), not O(N)), Pilates now runs the hot-relayout-with-boundaries scenario in ~7.1µs vs Yoga's ~51µs.

The boundary path is opt-in by tree shape, not API. Any explicit-sized container with default flex grow/shrink qualifies. No new public types, no new methods on `Node`. Existing trees benefit automatically as soon as a container above the mutation point has both axes pinned.

## What this is, what it isn't

Pilates is structured as five focused packages:

- `@pilates/core` — the layout engine. Imperative `Node` API. Zero runtime deps.
- `@pilates/render` — declarative POJO tree → painted ANSI string.
- `@pilates/diff` — frame-to-frame cell diff → minimal redraw sequences.
- `@pilates/react` — React 19 reconciler driving the above.
- `@pilates/widgets` — interactive widgets (`<TextInput>`, `<Select>`, `<MultiSelect>`, `<Tabs>`, `<Table>`, `<TextArea>`, `<ProgressBar>`, `<Spinner>`).

The split is the product. You can take just `@pilates/core` if you want to drive a non-React runtime (Vue, Solid, vanilla, custom DSL). Ink doesn't expose that path.

This is **not** a drop-in Ink replacement. Ink has 7 years of bug-fixing, more tutorials, more answered questions on Stack Overflow. If you're shipping a CLI tomorrow, Ink is still the safe bet. Pilates is the bet that pure-TS, unbundled, faster matters more than maturity for greenfield projects.

## How the validation works (because cache-correctness bugs are nightmare bugs)

Layout caches are exactly the kind of thing where theoretical analysis confidently arrives at the wrong answer. Three correctness bugs surfaced during Phase 2 and Phase 3 development that careful reasoning got wrong:

1. **Phase 2:** the layout cache stores rounded values; when an ancestor's position changes, descendants' absolute coordinates shift, and re-rounding restored values gives wrong results. Caught by the fuzzer, fixed by gating the cache fast-path on a `useCache` flag.

2. **Phase 3:** the spec argued `flexGrow > 0` was fine for relayout boundaries because grow is parent-state, not descendant-state. The fuzzer disagreed: produced a `cached=17 vs cold=16` width drift via multi-child grow interactions. The strict rule (require `flexGrow ≤ 0`) is what passes 500-run fuzzer sweeps.

3. **Phase 3:** `roundLayoutSubtree` (inline subtree rounding for dirty boundaries under clean roots) used rounded integer ancestor positions, while the cold-path `roundLayout` uses unrounded float positions. When parent flex-shrinking gave an ancestor a fractional position, the cached path's anchor was off by 0.5, crossing half-integer rounding thresholds. Surfaced only on macOS CI with seed `1283320469`. Fixed by capturing pre-rounding float positions on every node.

The pattern: when the fuzzer disagrees with reasoning, the fuzzer wins. Differential mode (every layout test runs twice — cached and cold — and asserts byte-identical results) plus property-based fuzzing (500 random tree+mutation sequences per CI run, asserting cached == cold) is the validation infrastructure that lets us trust the cache. It pays for itself.

## Try it

```bash
npm install @pilates/core
```

```ts
import { Node, Edge } from '@pilates/core';

const root = Node.create();
root.setFlexDirection('row');
root.setWidth(80); root.setHeight(24);

const main = Node.create(); main.setFlex(1);
const sidebar = Node.create(); sidebar.setWidth(20);

root.insertChild(main, 0);
root.insertChild(sidebar, 1);
root.calculateLayout();

main.getComputedLayout();    // { left:0, top:0, width:60, height:24, ... }
sidebar.getComputedLayout(); // { left:60, top:0, width:20, height:24, ... }
```

Or with the React reconciler:

```bash
npm install @pilates/react @pilates/widgets
```

```tsx
import { render, Box, Text, useState } from '@pilates/react';
import { TextInput, Select } from '@pilates/widgets';

function App() {
  const [name, setName] = useState('');
  return (
    <Box flexDirection="column" padding={1}>
      <Text>What is your name?</Text>
      <TextInput value={name} onChange={setName} />
      <Text>Hello, {name || '...'}</Text>
    </Box>
  );
}

render(<App />);
```

Repository: <https://github.com/pilatesjs/pilates>
Bench reproduction: `pnpm bench`
Strategy + roadmap: [docs/STRATEGY.md](https://github.com/pilatesjs/pilates/blob/main/docs/STRATEGY.md)

---

# Tweet / X copy

**Tweet 1 (announcement):**

> Pilates 1.0 is shaping up. Pure-TS terminal-UI flex layout engine, validated cell-for-cell against WASM Yoga across 33 fixtures + a 500-run-per-CI property fuzzer.
>
> Phase 3 just landed: relayout boundaries. Pilates now beats Yoga 7× on the hot-relayout pattern Yoga used to win on.
>
> github.com/pilatesjs/pilates

**Tweet 2 (numbers):**

> Pure-TS layout engine vs WASM Yoga, mean latency:
>
> · 10 nodes: 1.5µs vs 15µs (10×)
> · 100 nodes: 29µs vs 263µs (9×)
> · 1k nodes: 0.17ms vs 1.52ms (9×)
> · 10k nodes: 2.16ms vs 14.6ms (7×)
> · hot-relayout w/ boundaries: 7.1µs vs 51µs (7×)
>
> JS↔WASM call overhead dominates Yoga's compute advantage at TUI sizes.

**Tweet 3 (the lesson):**

> Tip from a week of cache work: when your property-based fuzzer disagrees with your theoretical analysis, the fuzzer wins. Three subtle correctness bugs surfaced during the Pilates layout-cache work. Differential testing (cached vs cold paths byte-identical) caught all three.

**Tweet 4 (call to action):**

> If you write CLI tools or interactive terminals in JavaScript and have ever wished the layout engine wasn't WASM, Pilates is for you. 0 deps, pure TS, faster than Yoga.
>
> `npm i @pilates/core` (1.0 next), `npm i @pilates/react` for the React layer.
>
> github.com/pilatesjs/pilates

---

# HN title options

HN moderators routinely rewrite titles containing superlatives ("fastest",
"faster than X", "best") and comparison framing reads as marketing to the
HN audience. Use a descriptive title, then put the benchmark comparison in
your own first top-level comment immediately after submitting.

Pick whichever lands best (ranked):

1. **"Show HN: Pilates – a pure-TypeScript flex layout engine for terminal UIs"** *(safest — descriptive, no claim, no edit risk)*
2. **"Show HN: Pilates – pure-TS terminal-UI layout, no WASM"** *(the "no WASM" parenthetical implies the Yoga comparison without making the claim)*
3. **"Show HN: Pilates 1.0 – terminal-UI flex layout in pure TypeScript"** *(version-as-news framing)*

# Author's first comment (post immediately after submission)

This is where the benchmark table and the Yoga comparison live. Posting it
as the first top-level comment, by you, pins the context without forcing
moderators to edit the title.

> **Some context on why we built this**
>
> Terminal UI in JavaScript today means [Ink](https://github.com/vadimdemedes/ink), which uses [Yoga](https://github.com/facebook/yoga) (Facebook's flex engine, compiled to WASM) for layout. Yoga's compute kernel is hand-tuned C++ and very fast in absolute terms, but every `node.setWidth(N)` crosses the JS↔WASM boundary, and at TUI tree sizes (10–10000 nodes) the marshalling cost dominates the compute advantage.
>
> Pilates is a from-scratch flex layout engine in pure TypeScript, no WASM, zero runtime dependencies. Validated cell-for-cell against Yoga across 33 oracle fixtures plus a 500-runs-per-CI property fuzzer.
>
> Bench numbers (mean per-pass, lower is better):
>
> | Scenario | Pilates | yoga-layout (WASM) | Speedup |
> |---|---:|---:|---:|
> | 10 nodes | 1.5µs | 15.1µs | 10× |
> | 100 nodes | 29µs | 263µs | 9× |
> | 1k nodes | 0.17ms | 1.52ms | 9× |
> | 10k nodes | 2.16ms | 14.6ms | 7× |
> | 1k tree, mutate one leaf/frame | 129µs | 56µs | Yoga wins ~2.3× |
> | Same + explicit-sized container rows | 7.1µs | 51µs | 7× |
>
> The last row is this week's headline: a node with explicit `width` AND `height` (a common TUI pattern — fixed-height rows, sidebars) acts as a Flutter-style relayout boundary, stopping dirty propagation. Combined with subtree dirty-tracking, the cache-hit path is O(dirty), not O(N). Closes the one workload Yoga used to win.
>
> Reproduce: `git clone github.com/pilatesjs/pilates && pnpm install && pnpm bench`
>
> Happy to answer questions about the cache-correctness work — three subtle bugs surfaced during Phase 2/3 that careful reasoning got wrong, and the differential-mode fuzzer caught all of them. There's a section in the [post draft](https://github.com/pilatesjs/pilates/blob/main/docs/announcements/2026-05-09-faster-than-yoga.md) on those.

# Notes for the maintainer before posting

- Don't post until `@pilates/core` 1.0.0 is on npm. The "1.0 next" framing only works if the next-week-tag is concrete.
- Re-run `pnpm bench` on a clean machine before pasting numbers — local-dev variance can drift.
- Best posting window: US Eastern Tuesday–Thursday, 8–10am.
- Post the "Author's first comment" above as an immediate top-level reply once submitted. That's the pinned context.
- Anticipate the following pushback in HN comments:
  - **"Why not just contribute to Yoga?"** Yoga's WASM compile target is the cost we're avoiding. Contributing to Yoga doesn't help if the bottleneck is the bridge.
  - **"Why not Bun + Zig like OpenTUI?"** OpenTUI uses Yoga under the hood (via `yoga-layout@3.2.1`). They get the WASM bridge cost too. We don't.
  - **"This is just `react-reconciler` reinvented."** The reconciler is one of five packages. Take just the engine if you want.
  - **"7-year-old Ink is fine, why does this exist?"** Ink couples concerns; Pilates doesn't. Different tradeoff.
- The CHANGELOG (`packages/core/CHANGELOG.md`) has the engineering details for anyone who wants to dig.
