# Strategy

This is the canonical answer to "what is Pilates and where is it going?"
It supersedes scattered framing in package READMEs and supersedes any
older roadmap-ish content elsewhere.

## What Pilates is

A flex layout engine purpose-built for the terminal — pure TypeScript,
zero runtime dependencies, validated cell-for-cell against a reference
WASM flexbox implementation — packaged so consumers can take just the
engine, just the painter, the diff loop, the React reconciler, or any
combination, **without dragging in the rest**.

The split into five focused packages is the product. Each can be used
standalone (or in combination):

| Package | Use case | Depends on |
|---|---|---|
| `@pilates/core` | Imperative `Node` API → integer cell layouts | nothing |
| `@pilates/render` | Declarative POJO tree → painted ANSI string | core |
| `@pilates/diff` | Frame-to-frame cell diff → minimal ANSI redraw | render (for `Frame`) |
| `@pilates/react` | React 19 reconciler driving the above | core, render, diff |
| `@pilates/widgets` | Interactive widgets (`TextInput`, `Select`, `Spinner`) | react |

## Where Pilates sits

In JavaScript / TypeScript, the React-for-terminals niche is dominated
by **Ink** (~3M weekly downloads, 7-year incumbent). Ink couples its
flex layout engine (Yoga, WASM) to its React reconciler — you can't
take one without the other. Other JS options (`blessed`, `inquirer`,
`vorpal`) serve narrower niches.

Outside JS, the comparable libraries — Textual (Python), Ratatui (Rust),
Bubbletea (Go) — share the same general shape but different language
ecosystems entirely.

**Pilates' positioning is the unbundled alternative to Ink in the
JS/TS niche.**

## What Pilates actually offers vs. Ink

The wedge is *decoupling*, not "better DX":

1. **Take just the layout.** Want flex layout under a non-React runtime
   (Vue, Solid, vanilla, custom DSL)? `@pilates/core` is 0-dep TypeScript.
   Ink doesn't expose that path.

2. **No WASM in the critical path.** Pure TS layout engine, no
   `WebAssembly.compile` startup cost, no JS↔WASM marshalling on every
   layout pass. The benchmark in `bench/` shows Pilates beats
   `yoga-layout` (Ink's engine) by 9–14× across 10/100/1000-node trees
   when tree-construction is included. JS↔WASM call overhead dominates
   Yoga's compute advantage at TUI tree sizes.

3. **Tighter scope per package.** Single concern per package, easier
   to audit, easier to fork, smaller install footprint when you only
   need one piece.

What Pilates **doesn't** offer over Ink:

- A bigger feature set. Ink has more components, hooks, and years of
  bug-fixing.
- More maturity. Pilates is day-one; Ink has a 7-year lead.
- Better discovery. Ink owns the search results, the tutorials, the
  Stack Overflow answers.

That asymmetry is load-bearing for strategy: don't try to out-Ink Ink.
Win on the architectural commitments Ink can't change without breaking
its install base.

## What Pilates deliberately doesn't do

- **No widgets in the engine or reconciler.** Widgets live in their own
  opt-in package, `@pilates/widgets` (`<TextInput>`, `<Select>`,
  `<Spinner>` shipped 2026-04-30). The engine, render layer, and React
  reconciler don't carry them — you don't pay for widgets if you don't
  import the widgets package.
- **No animation primitives.** Terminal isn't a 60-fps medium.
- **No alt-screen / mouse / clipboard / kitty graphics protocol.**
  Stays in the scrollback, writes ANSI, exits cleanly. Out of scope
  unless the project's identity shifts.
- **No concurrent-mode React.** Terminal use case is genuinely unclear;
  the reconciler complexity isn't worth speculative gain.

## Roadmap

### Now (in flight)

- **`@pilates/core@1.0.0-rc.1` and `@pilates/render@1.0.0-rc.2` bake
  until 2026-05-13** (issue #11). After bake-end with no blocking
  feedback, both promote to `1.0.0` and `@pilates/diff` bumps to
  `0.2.0`.
- **`@pilates/widgets@0.1.0-rc.1` bakes through ~2026-05-15** (concurrent
  with the core/render bake). Promotes to `0.1.0` if no blocking issues.
- **Scheduled routines** at https://claude.ai/code/routines fire on
  those dates with the issue-tracker check + promotion checklist.

### Done

- **`useInput` (shipped 2026-05-01).** `@pilates/react@0.2.0` added a
  discriminated `KeyEvent` API + xterm-compatible key parser + lazy
  raw-mode lifecycle. Closed the input gap that previously kept the
  reconciler limited to "watch this tick" demos. Spec:
  `docs/superpowers/specs/2026-04-30-useInput-design.md`.
- **`@pilates/widgets@0.1.0-rc.1` (shipped 2026-04-30).** A separate
  fifth package on top of `@pilates/react` with `<TextInput>`,
  `<Select>`, `<Spinner>` — the trio that closes the practical
  adoption gate ("how do I prompt for a string?"). `<MultiSelect>`
  and `<Table>` deferred to a `0.2+` minor on demand. Spec:
  `docs/superpowers/specs/2026-05-01-widgets-design.md`.

### Next: promote core/render/diff to 1.0

After 2026-05-13 with no blocking feedback: bump `@pilates/core` →
`1.0.0`, `@pilates/render` → `1.0.0`, `@pilates/diff` → `0.2.0`.
Closes #11. No new features — pure version-bump and release-note work.

### Beyond v1 (demand-driven, no commitment)

- **`useFocus`** — fold in if multi-input forms / tab navigation
  surface real use cases. Deferred from the original `useInput` and
  widgets work because the demand wasn't concrete yet.
- **`<MultiSelect>`, `<Table>` widgets** — ship in
  `@pilates/widgets@0.2+` on demand.
- **`<Static>`** (append-only region above the live area) —
  interesting for log-above-status patterns; ship if requested.
- **`<Transform>`** (paint-time text post-processor) — interesting
  for gradients, hyperlinks; ship if requested.
- **Nested-`<Text>` style inheritance** — known v0.1 limitation;
  fix when a real workflow hits it.

These are deliberately demand-driven, not roadmap-driven.

## Decision rules for new feature requests

When an issue or proposal arrives, evaluate against these gates:

1. **Does it require coupling layout to reconciler, or paint to layout?**
   If yes, decline — that violates the unbundling thesis.
2. **Could it live in a separate package without losing meaning?**
   If yes, it should — keep core packages small.
3. **Is it solving a problem real users hit, or a problem we imagine?**
   Demand-driven over speculation. The four-package set has earned
   "ship it"; everything else needs evidence.
4. **Does it require WASM, native bindings, or a parser library?**
   Heavily skeptical — zero runtime deps is a real feature.
5. **Does it match Ink's API, or improve on it?** Match Ink for
   *names* (Box, Text, Spacer, useApp) where the names are obviously
   right. *Improve* on signatures where Ink's design is dated (e.g.
   `useInput`'s bag-of-booleans → discriminated event).

## Status of this document

Living. Update when the roadmap shifts. Don't update when a single
feature gets added or fixed — those belong in `CHANGELOG.md`.
