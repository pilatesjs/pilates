# Pilates 1.0 — Launch Day Playbook

> Copy-paste-ready content for HN, Twitter/X, r/javascript, r/commandline.
> Do steps in order. Don't customize between platforms — same numbers,
> same framing keeps your story consistent across the day.

## The play

1. **HN** — submit, then post the first-comment within 60 seconds
2. **Twitter/X** — 4-tweet thread, replies chained
3. **r/javascript** — 30 min after HN
4. **r/commandline** — 30 min after r/javascript
5. **Stay engaged for the first 90 minutes on HN** — that window decides whether you hit the front page

Best window: US Eastern **Tuesday–Thursday, 8–10am**.

---

## 1. Hacker News

### Submission form

| Field | Value |
|---|---|
| Title | `Show HN: Pilates – a pure-TypeScript flex layout engine for terminal UIs` |
| URL | `https://github.com/pilatesjs/pilates` |
| Text | *(leave blank — the URL is the submission)* |

### Author's first comment (post within 60 seconds of submitting)

Copy the block below verbatim and submit as a top-level comment on your own post. HN comments are plain text — no markdown tables, monospace columns work best:

```
Some context on why we built this:

Terminal UI in JavaScript today means Ink (https://github.com/vadimdemedes/ink),
which uses Yoga (https://github.com/facebook/yoga) — Facebook's flex engine,
compiled to WASM — for layout. Yoga's compute kernel is hand-tuned C++ and
very fast in absolute terms, but every node.setWidth(N) crosses the JS↔WASM
boundary, and at TUI tree sizes (10–10000 nodes) the marshalling cost
dominates the compute advantage.

Pilates is a from-scratch flex layout engine in pure TypeScript, no WASM,
zero runtime dependencies. Validated cell-for-cell against Yoga across 33
oracle fixtures plus a 500-runs-per-CI property fuzzer.

Bench numbers (mean per-pass on darwin/arm64, Node 26, lower is better):

  10 nodes:           1.5µs   vs Yoga 15.1µs  (10×)
  100 nodes:          29µs    vs Yoga 263µs   (9×)
  1k nodes:           0.17ms  vs Yoga 1.52ms  (9×)
  10k nodes:          2.16ms  vs Yoga 14.6ms  (7×)
  1k, mutate 1/frame: 129µs   vs Yoga 56µs    (Yoga wins ~2.3×)
  Same + boundaries:  7.1µs   vs Yoga 51µs    (7×)

The last row is this week's headline: a node with explicit width AND height
(common TUI pattern — fixed-height rows, sidebars) acts as a Flutter-style
relayout boundary, stopping dirty propagation. Combined with subtree
dirty-tracking, the cache-hit path is O(dirty), not O(N). Closes the one
workload Yoga used to win.

Reproduce: git clone github.com/pilatesjs/pilates && pnpm install && pnpm bench

Happy to answer questions about the cache-correctness work — three subtle
bugs surfaced during Phase 2/3 that careful reasoning got wrong, and the
differential-mode fuzzer caught all of them.
```

---

## 2. Twitter / X thread

Four tweets, each a reply to the previous one.

### Tweet 1

```
Pilates 1.0 is out. Pure-TS terminal-UI flex layout engine, validated cell-for-cell against WASM Yoga across 33 fixtures + a 500-run-per-CI property fuzzer.

Phase 3 just landed: relayout boundaries. Pilates now beats Yoga 7× on the hot-relayout pattern Yoga used to win on.

github.com/pilatesjs/pilates
```

### Tweet 2 (reply to #1)

```
Pure-TS layout engine vs WASM Yoga, mean latency (darwin/arm64):

· 10 nodes: 1.5µs vs 15µs (10×)
· 100 nodes: 29µs vs 263µs (9×)
· 1k nodes: 0.17ms vs 1.52ms (9×)
· 10k nodes: 2.16ms vs 14.6ms (7×)
· hot-relayout w/ boundaries: 7.1µs vs 51µs (7×)

JS↔WASM call overhead dominates Yoga's compute advantage at TUI sizes.
```

### Tweet 3 (reply to #2)

```
Tip from a week of cache work: when your property-based fuzzer disagrees with your theoretical analysis, the fuzzer wins. Three subtle correctness bugs surfaced during the Pilates layout-cache work. Differential testing (cached vs cold paths byte-identical) caught all three.
```

### Tweet 4 (reply to #3)

```
If you write CLI tools or interactive terminals in JavaScript and have ever wished the layout engine wasn't WASM, Pilates is for you. 0 deps, pure TS, faster than Yoga.

npm i @pilates/core (1.0 live), npm i @pilates/react for the React layer.

github.com/pilatesjs/pilates
```

---

## 3. Reddit — r/javascript

### Title

```
Show /r/javascript: Pilates — a pure-TypeScript flex layout engine for terminal UIs, faster than WASM Yoga
```

### Body (Reddit renders markdown — keep the table)

```markdown
Hi /r/javascript,

I've spent the last few months building [Pilates](https://github.com/pilatesjs/pilates), a flex layout engine for terminal UIs in pure TypeScript. Just shipped 1.0.

**The problem:** Terminal UI in JS means [Ink](https://github.com/vadimdemedes/ink), which uses [Yoga](https://github.com/facebook/yoga) (Facebook's flex engine, compiled to WASM) for layout. Yoga's compute kernel is hand-tuned C++ and very fast in absolute terms, but every `node.setWidth(N)` call crosses the JS↔WASM boundary, and at TUI tree sizes (10–10000 nodes) the marshalling cost dominates.

**What Pilates is:** A from-scratch flex layout engine in pure TypeScript, no WASM, zero runtime dependencies. Validated cell-for-cell against Yoga across 33 oracle fixtures plus a 500-runs-per-CI property fuzzer. Also ships:

- `@pilates/core` — the engine, imperative Node API
- `@pilates/render` — declarative POJO tree → painted ANSI string
- `@pilates/diff` — frame-to-frame cell diff + minimal redraw
- `@pilates/react` — React 19 reconciler driving the above
- `@pilates/widgets` — TextInput, Select, Spinner, ProgressBar, etc.

Take just the engine if you want to drive a non-React runtime (Vue, Solid, vanilla).

**Bench numbers** (mean per-pass on darwin/arm64, Node 26, lower is better):

| Scenario | Pilates | yoga-layout (WASM) | Speedup |
|---|---:|---:|---:|
| 10 nodes | 1.5µs | 15.1µs | 10× |
| 100 nodes | 29µs | 263µs | 9× |
| 1k nodes | 0.17ms | 1.52ms | 9× |
| 10k nodes | 2.16ms | 14.6ms | 7× |
| 1k tree, mutate 1 leaf/frame | 129µs | 56µs | Yoga wins ~2.3× |
| Same + explicit-sized boundaries | 7.1µs | 51µs | 7× |

The last row is this week's headline: explicit-sized container nodes act as Flutter-style relayout boundaries, stopping dirty propagation. Closes the one workload Yoga used to win.

Reproduce: `git clone github.com/pilatesjs/pilates && pnpm install && pnpm bench`

Happy to answer questions about the layout-cache correctness work, the JS↔WASM bridge cost, or anything else.
```

---

## 4. Reddit — r/commandline

Slightly different framing — emphasize the TUI-builder angle, not the perf one.

### Title

```
Pilates 1.0 — pure-TypeScript flex layout for terminal UIs, with React reconciler + interactive widgets
```

### Body

```markdown
Hi /r/commandline,

If you build TUIs in JavaScript / TypeScript, today might interest you. [Pilates](https://github.com/pilatesjs/pilates) just hit 1.0.

**What it does:** Headless flex layout engine in pure TypeScript (no WASM), plus an optional React reconciler and an interactive widget library. Designed for terminal-shaped problems: integer cell coordinates, CJK / emoji / wide-char awareness, ANSI escape passthrough.

The split is the product. You can:

- Take just `@pilates/core` to compute layouts and paint cells yourself
- Take `@pilates/render` for declarative tree → painted ANSI string
- Take `@pilates/react` for a full JSX / hooks / mouse / focus / scroll experience
- Mix and match — they're independent packages

**Flagship demo:** `react-build-dashboard` — multi-pane interactive build pipeline with two `<ScrollView>` panes, `useFocus` keyboard nav, mouse click + scroll, `<ProgressBar>` + `<Spinner>` widgets, live animation. Run with:

    npx --package @pilates-examples/react-build-dashboard pilates-build-dashboard

(Or `pnpm --filter @pilates-examples/react-build-dashboard dev` from a clone.)

**Why pure TS:** Most JS TUI libraries (Ink, OpenTUI) layer on top of WASM Yoga for layout. That's fast compute but every property setter crosses the JS↔WASM boundary, and at terminal tree sizes the marshalling cost dominates. Pilates avoids the bridge — typically 7–10× faster than Yoga on the same workload.

Repo + benchmarks: https://github.com/pilatesjs/pilates

Happy to chat about the design tradeoffs vs. blessed / terminal-kit / Ink / OpenTUI / Textual.
```

---

## 5. After you post — first 90 minutes

- **Reply to every HN comment** in the first hour. Even one-word "thanks" counts — moderators reward author engagement
- **Don't argue.** If a critique is true, say "fair point" + what you'd do differently
- **The "Why not contribute to Yoga?" comment is coming.** Answer: *"Yoga's WASM compile target is the cost we're avoiding. Even if Yoga's C++ kernel were 2× faster tomorrow, every node.setWidth() still pays the boundary cost. Pure-TS is the architectural difference, not the optimization difference."*
- **Drop the announcement link** to https://github.com/pilatesjs/pilates/blob/main/docs/announcements/2026-05-09-faster-than-yoga.md in any HN reply that asks for deeper technical context

## Anticipated pushback & one-line answers

| Comment | Answer |
|---|---|
| "Why not just contribute to Yoga?" | Yoga's WASM compile target is the cost we're avoiding. Contributing to Yoga doesn't help if the bottleneck is the bridge. |
| "Why not Bun + Zig like OpenTUI?" | OpenTUI uses Yoga under the hood (via `yoga-layout@3.2.1`). They get the WASM bridge cost too. We don't. |
| "This is just `react-reconciler` reinvented." | The reconciler is one of five packages. Take just the engine if you want — `@pilates/core` doesn't import React. |
| "7-year-old Ink is fine, why does this exist?" | Ink couples layout + reconciler. Pilates separates them. Different tradeoff for greenfield projects. |
| "Numbers will vary on my machine." | Yes — the README and the bench output both say so. Relative positions are the signal, and `pnpm bench` reproduces on any machine. |
| "Why should I trust the cache is correct?" | Differential mode: every layout test runs twice (cached + cold) and asserts byte-identical results. 500-runs-per-CI property fuzzer caught 3 real bugs during dev — see the announcement post for details. |

## When you're done

- Drop the HN URL back to me — happy to watch the thread with you
- If a comment thread gets technical and you want a hand drafting a longer reply, just paste it back here
