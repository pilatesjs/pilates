# Pilates: a pure-TypeScript flex layout engine that beats WASM Yoga at terminal-UI workloads

*Draft of an HN / blog announcement following the Spineless incremental engine (phases 8–12) landing. Not for publication until the maintainer reviews and the `@pilates/core` 1.1.0 promotion lands.*

---

## TL;DR

[Pilates](https://github.com/pilatesjs/pilates) is a five-package layout-and-render stack for terminal UIs. The headline change in this release: the layout engine is now faster than WASM Yoga (Ink's engine) on every flex-layout workload — including **every** hot-relayout shape Yoga had historically won on, with or without explicit-sized container boundaries.

Numbers (Node 26, darwin/arm64, `pnpm bench`):

| Scenario | Pilates core | yoga-layout (WASM) | Pilates speedup |
|---|---:|---:|---:|
| 10-node tree | 2.9µs | 15.4µs | **5×** |
| ~100-node tree | 32µs | 268µs | **8×** |
| ~1000-node tree | 181µs | 1.56ms | **9×** |
| ~5000-node tree | 1.05ms | 7.39ms | **7×** |
| ~10000-node tree | 2.40ms | 15.3ms | **6×** |
| **1k-node persistent tree, mutate one leaf/frame** | **19.1µs** | **57.9µs** | **3×** |
| **Same + explicit-sized container rows** | **18.5µs** | **51.5µs** | **3×** |
| **Same + fixed-size cells (text-mutation pattern)** | **20.1µs** | **47.0µs** | **2.3×** |

Reproduce: `git clone github.com/pilatesjs/pilates && pnpm install && pnpm bench`.

## Why this matters

Terminal UI in JavaScript means [Ink](https://github.com/vadimdemedes/ink). Ink uses [Yoga](https://github.com/facebook/yoga) (Facebook's flex layout engine, compiled to WASM) for layout and pairs it with a React reconciler. The split is invisible from the consumer side: you get them together. Yoga's compute kernel is genuinely fast — it's hand-tuned C++ — but every `node.setWidth(N)` crosses the JS↔WASM boundary, and that marshalling cost dominates Yoga's compute advantage at TUI tree sizes (10–10000 nodes).

Pilates is a from-scratch flex layout engine in pure TypeScript, validated cell-for-cell against Yoga across 33 oracle fixtures plus property-based and structural fuzzers running on every CI build. No WASM, no JS↔WASM bridge, zero runtime dependencies.

For tree-build-then-layout (the natural shape of a TUI redrawing every frame from declarative state), Pilates has been faster than Yoga since day one: 5–9× across all scenarios. The workload Yoga still won was *long-lived trees with hot relayouts* — build once, mutate one leaf, relayout, repeat. The build cost amortizes, only the layout pass is measured, and Yoga's compute speed shows.

This release flips that. The **Spineless incremental layout engine** re-expresses flex as an attribute grammar — every layout field (`(Node, attribute)` pair) has a rule that computes its value from other fields it depends on — and a runtime built around an Order-Maintenance data structure and a priority-queued dirty-set evaluator. A leaf mutation re-evaluates only the fields actually downstream of the change, in O(N) total work for the affected row instead of O(N²). The phase-12 refactor (the final piece) hoists the row's flex distribution into one intermediate field that every in-flow child reads from — collapsing N redundant per-cell distribution computations into one shared compute.

The result: **Pilates wins every hot-relayout shape**, not just the boundary-tree special case the previous release shipped. Fully fluid trees, explicit-sized rows, and fixed-size text-mutation tables all run at ~3× Yoga's throughput. The "the only workload Yoga still wins" caveat is gone.

Public API didn't change. `node.calculateLayout()` routes the first (cold) layout through the imperative path and the second-and-later layouts of a persistent tree through Spineless — automatically. No new types, no opt-in flag, no annotation. Existing trees benefit on upgrade.

## What this is, what it isn't

Pilates is structured as five focused packages:

- `@pilates/core` — the layout engine. Imperative `Node` API + the Spineless incremental engine inside. Zero runtime deps.
- `@pilates/render` — declarative POJO tree → painted ANSI string.
- `@pilates/diff` — frame-to-frame cell diff → minimal redraw sequences.
- `@pilates/react` — React 19 reconciler driving the above; layout devtools (`useLayoutProfiler`, `<LayoutDevtools>`).
- `@pilates/widgets` — interactive widgets (`<TextInput>`, `<Select>`, `<MultiSelect>`, `<Tabs>`, `<Table>`, `<TextArea>`, `<ProgressBar>`, `<Spinner>`).

The split is the product. You can take just `@pilates/core` if you want to drive a non-React runtime (Vue, Solid, vanilla, custom DSL). Ink doesn't expose that path.

This is **not** a drop-in Ink replacement. Ink has 7 years of bug-fixing, more tutorials, more answered questions on Stack Overflow. If you're shipping a CLI tomorrow, Ink is still the safe bet. Pilates is the bet that pure-TS, unbundled, faster matters more than maturity for greenfield projects.

## How the validation works (because layout-engine bugs are nightmare bugs)

Layout engines are exactly the kind of thing where theoretical analysis confidently arrives at the wrong answer. The Spineless work surfaced this repeatedly — bugs that careful reasoning got wrong, and that the fuzzers caught.

1. **The structural fuzzer (phase 11) found four real bugs theoretical review missed.** `finishIncremental` crashing on a hidden node in a moved subtree; a graft/detach fast-path firing inside a `display: 'none'` subtree; `buildRemoveFragment`'s `nodeFields` omitting non-leaf `measure:*` / `aspect:*` fields; the fragment builders rebuilding with an empty `available` causing an `'auto'` root to lose its size clamp. Each was pinned as a deterministic regression test after the fuzzer reproduced it.

2. **Phase 8's engine swap regressed the headline `hotrelayoutboundary` benchmark — and we didn't know until we profiled.** The imperative path's specialized 7µs boundary cache went away when Spineless took over, replaced by ~120µs of grammar evaluation. We caught it because the bench gate uses tinybench medians + threshold budgets in CI, but the *fix* required a thorough investigation: measure where time actually goes (`runtime.recompute` field count, not `finishIncremental`), inspect the grammar to find the O(N) per-cell sibling walk, write a probe that no-op'd subphases, and only then design the refactor. Phase 12 is what shipped.

3. **Cache correctness was always a fuzzer-driven discovery process.** Earlier perf phases (relayout boundaries, layout cache) surfaced three subtle correctness bugs that careful reasoning got wrong: rounded-vs-float ancestor positions producing 0.5px drift on macOS CI (seed `1283320469`); the spec's `flexGrow > 0` boundary rule producing a `cached=17 vs cold=16` width drift via multi-child grow interaction; the layout cache's restored-values needing protection from re-rounding. All caught by the value-differential fuzzer ("every layout test runs twice — cached and cold — and asserts byte-identical results").

The pattern: when the fuzzer disagrees with reasoning, the fuzzer wins. Differential mode + structural fuzzer + 33-fixture Yoga oracle + 500-run-per-CI property fuzz is the validation infrastructure that lets us trust an engine this aggressive. It pays for itself every release.

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

Or scaffold a starter:

```bash
npm create pilates-app my-app
```

Repository: <https://github.com/pilatesjs/pilates>
API reference: <https://pilatesjs.github.io/pilates/>
Bench reproduction: `pnpm bench`
Strategy + roadmap: [docs/STRATEGY.md](https://github.com/pilatesjs/pilates/blob/main/docs/STRATEGY.md)

---

# Tweet / X copy

**Tweet 1 (announcement):**

> Pilates 1.1 just landed. Pure-TS terminal-UI flex layout engine, validated cell-for-cell against WASM Yoga across 33 fixtures + structural-and-value differential fuzzers.
>
> Spineless incremental engine. Beats Yoga ~3× on every hot-relayout shape — the workloads Yoga used to win.
>
> github.com/pilatesjs/pilates

**Tweet 2 (numbers):**

> Pure-TS layout engine vs WASM Yoga, mean latency:
>
> · 10 nodes: 2.9µs vs 15.4µs (5×)
> · 100 nodes: 32µs vs 268µs (8×)
> · 1k nodes: 0.18ms vs 1.56ms (9×)
> · 10k nodes: 2.40ms vs 15.3ms (6×)
> · hot-relayout (1k persistent, mutate one leaf/frame): 19.1µs vs 57.9µs (3×)
>
> JS↔WASM call overhead + incremental field propagation beat WASM compute at TUI sizes.

**Tweet 3 (the lesson):**

> Tip from a year of engine work: when your property-based fuzzer disagrees with your theoretical analysis, the fuzzer wins. The structural fuzzer found 4 real bugs careful design review missed. Differential testing (incremental vs cold byte-identical) caught them all.

**Tweet 4 (call to action):**

> If you write CLI tools or interactive terminals in JavaScript and have ever wished the layout engine wasn't WASM, Pilates is for you. 0 deps, pure TS, faster than Yoga on every flex-layout workload.
>
> `npm i @pilates/core` or `npm create pilates-app` for a starter.
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
3. **"Show HN: Pilates 1.1 – terminal-UI flex layout in pure TypeScript"** *(version-as-news framing)*

# Author's first comment (post immediately after submission)

This is where the benchmark table and the Yoga comparison live. Posting it
as the first top-level comment, by you, pins the context without forcing
moderators to edit the title.

> **Some context on why we built this**
>
> Terminal UI in JavaScript today means [Ink](https://github.com/vadimdemedes/ink), which uses [Yoga](https://github.com/facebook/yoga) (Facebook's flex engine, compiled to WASM) for layout. Yoga's compute kernel is hand-tuned C++ and very fast in absolute terms, but every `node.setWidth(N)` crosses the JS↔WASM boundary, and at TUI tree sizes (10–10000 nodes) the marshalling cost dominates the compute advantage.
>
> Pilates is a from-scratch flex layout engine in pure TypeScript, no WASM, zero runtime dependencies. Validated cell-for-cell against Yoga across 33 oracle fixtures plus structural and value differential fuzzers running on every CI build.
>
> Bench numbers (mean per-pass, lower is better):
>
> | Scenario | Pilates | yoga-layout (WASM) | Speedup |
> |---|---:|---:|---:|
> | 10 nodes | 2.9µs | 15.4µs | 5× |
> | 100 nodes | 32µs | 268µs | 8× |
> | 1k nodes | 0.18ms | 1.56ms | 9× |
> | 10k nodes | 2.40ms | 15.3ms | 6× |
> | 1k tree, mutate one leaf/frame | 19.1µs | 57.9µs | 3× |
> | Same + explicit-sized container rows | 18.5µs | 51.5µs | 3× |
> | Same + fixed-size cells (text mutation) | 20.1µs | 47.0µs | 2.3× |
>
> The bottom three rows are the headline. Pilates ships an **incremental layout engine** ("Spineless"): a flex grammar where each layout field declares its dependencies on other fields, plus a runtime that on a mutation re-evaluates only the fields actually downstream. Per-row work drops from O(N²) (each cell redoes the full flex distribution) to O(N) (the row's distribution is one shared intermediate field; cells index into it). Across the entire hot-relayout matrix Pilates now wins ~3×.
>
> Reproduce: `git clone github.com/pilatesjs/pilates && pnpm install && pnpm bench`
>
> Happy to answer questions about the validation work — the structural-differential fuzzer found four real bugs careful design review missed, including one where the imperative engine's specialized boundary cache regressed during the Spineless swap (phase 8) and a thorough refactor (phase 12) was needed to recover the headline win. There's a section in the [post draft](https://github.com/pilatesjs/pilates/blob/main/docs/announcements/2026-05-09-faster-than-yoga.md) on those.

# Notes for the maintainer before posting

- Don't post until `@pilates/core` 1.1.0 is on npm. The "1.1 just landed" framing only works if the version-tag is concrete.
- Re-run `pnpm bench` on a clean machine before pasting numbers — local-dev variance can drift. The table above is darwin/arm64 / Node 26.
- Best posting window: US Eastern Tuesday–Thursday, 8–10am.
- Post the "Author's first comment" above as an immediate top-level reply once submitted. That's the pinned context.
- Anticipate the following pushback in HN comments:
  - **"Why not just contribute to Yoga?"** Yoga's WASM compile target is the cost we're avoiding. Contributing to Yoga doesn't help if the bottleneck is the bridge.
  - **"Why not Bun + Zig like OpenTUI?"** OpenTUI uses Yoga under the hood (via `yoga-layout@3.2.1`). They get the WASM bridge cost too. We don't.
  - **"This is just `react-reconciler` reinvented."** The reconciler is one of five packages. Take just the engine if you want.
  - **"7-year-old Ink is fine, why does this exist?"** Ink couples concerns; Pilates doesn't. Different tradeoff.
- The CHANGELOG (`packages/core/CHANGELOG.md`) has the engineering details for anyone who wants to dig.
