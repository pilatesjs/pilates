# `@pilates/widgets` — design

**Date:** 2026-05-01
**Status:** Approved (brainstorming complete; pending plan)
**Target release:** `@pilates/widgets@0.1.0-rc.1` (promote to `0.1.0` after bake)
**Strategy alignment:** STRATEGY.md Phase 3 — separate widget library on top of `@pilates/react`.

## Goal

Ship the canonical interactive widgets that prompt-style CLIs need, as a fifth package layered on top of `@pilates/react`. Without these, every consumer rebuilds the same primitives (text input with cursor, single-select menu, spinner) from `<Box>` + `<Text>` + `useInput`. With them, the package becomes the obvious answer to "how do I prompt for a string?" / "how do I show progress?".

The widgets stay in a separate package so `@pilates/react` itself remains small and the "compose what you need" thesis holds.

## Strategic decisions (locked)

| Decision | Choice | Rationale |
|---|---|---|
| v0.1 scope | `<TextInput>`, `<Select>`, `<Spinner>` only — trio | Closes prompt + menu + progress, the three patterns nearly every CLI hits. `<MultiSelect>` and `<Table>` deferred to v0.2+ on demand (rule 3: demand-driven over speculation). Table specifically has the largest API surface and the most to gain from real user signal before locking. |
| Layering | Depend only on `@pilates/react` (peer) + `react` (peer). Nothing reaches into `@pilates/render` or `@pilates/core`. | All trio widgets are achievable with react primitives. If a widget feels like it needs to reach below, that's a signal `@pilates/react` is missing a primitive — fix react, don't bypass it from widgets. |
| Dep style | Both `react` and `@pilates/react` are peer deps, not hard deps | Two copies of the reconciler in one app would mean two React trees and two stdin subscriptions. Peer-dep is the only safe shape. |
| API conventions | Match Ink's prop names where they hold up; deviate only with reason | Continuity for Ink migrants; small surface to learn. Per STRATEGY.md decision rule #5. |
| Controlled vs uncontrolled | `<TextInput>` controlled-only (`value` + `onChange`); `<Select>` callback-only (`onSelect` + optional `onHighlight`); `<Spinner>` no state surface | Terminal apps almost always need parent-owned state for wizards / validation / branching, so controlled is the right default. Uncontrolled adds complexity for no real win. |
| Select item shape | `{ label, value, key?, disabled? }` — `disabled` from day 1 | Adding `disabled` later is non-breaking but skipping it forces every consumer to filter their own arrays. Cheap to include now. |
| Select `limit` | Out | Most-bug-prone Ink feature — virtual-scroll math, edge cases at top/bottom, focus jumps. Defer until a user files an issue with a concrete shape. |
| Spinner frame source | Inline ~5 frame sets (`dots`, `line`, `arrow`, `bouncingBar`, `bouncingBall`) | Preserves Pilates' zero-runtime-deps thesis. `frames` array escape hatch lets users pull the full `cli-spinners` catalog if they want it. |
| Type-ahead in Select | Out | Adds another input mode. Defer until requested. |
| Focus management | None — each widget has its own `focus` prop that gates its own `useInput`'s `isActive` | `useFocus` itself is deferred (STRATEGY.md). A `<Select>` and a `<TextInput>` rendered together both subscribe; consumers wire mutual-exclusion via their own `focus` prop. |

## Architecture

### Package layout

```
packages/widgets/
├── package.json              type=module, peerDeps: react ^19.0.0, @pilates/react ^0.2.0
├── tsconfig.json             extends ../../tsconfig.base.json
├── README.md
├── CHANGELOG.md
└── src/
    ├── index.ts              barrel: TextInput, Select, Spinner + public types
    ├── text-input.tsx
    ├── select.tsx
    ├── spinner.tsx
    ├── spinner-frames.ts     inline frame catalog
    ├── text-input.test.tsx
    ├── select.test.tsx
    └── spinner.test.tsx
```

Single barrel export. The package is small enough that subpath exports would add user-facing complexity (and dual-publish bookkeeping) for no real win.

### Layering

```
┌──────────────────────────┐
│   @pilates/widgets       │  ← this package
└──────────┬───────────────┘
           │ peer
┌──────────▼───────────────┐
│   @pilates/react         │  ← <Box>, <Text>, useInput, KeyEvent
└──────────┬───────────────┘
           │
┌──────────▼───────────────┐
│ @pilates/render / core   │  ← never imported from widgets
└──────────────────────────┘
```

Every widget is a function component that composes `<Box>` / `<Text>` from `@pilates/react` and subscribes its own `useInput`. No direct stdin, no direct stdout writes, no cell-level access.

## Public API

### `<TextInput>`

```tsx
import { TextInput } from '@pilates/widgets';

interface TextInputProps {
  /** Controlled value. Required. */
  value: string;
  /** Called on every value change. Required. */
  onChange: (value: string) => void;
  /** Called on Enter. */
  onSubmit?: (value: string) => void;
  /** Rendered with `<Text dim>` when `value === ''`. */
  placeholder?: string;
  /** If set, renders this character in place of every visible char. Single character only — throws if longer. */
  mask?: string;
  /** Default true. When false, does not consume keystrokes and does not render a cursor. */
  focus?: boolean;
}
```

### `<Select>`

```tsx
import { Select } from '@pilates/widgets';

interface SelectItem<T> {
  label: string;
  value: T;
  /** Stable identity for React reconciliation. Defaults to `String(value)` if omitted. */
  key?: string;
  /** When true, item cannot receive highlight or be selected. */
  disabled?: boolean;
}

interface SelectProps<T> {
  items: SelectItem<T>[];
  /** Called on Enter when the highlighted item is not disabled. Required. */
  onSelect: (item: SelectItem<T>) => void;
  /** Called every time the highlight moves. */
  onHighlight?: (item: SelectItem<T>) => void;
  /** Default 0; clamped forward to first non-disabled item. */
  initialIndex?: number;
  /** Default true. */
  focus?: boolean;
  /**
   * Custom marker rendered to the left of each row. Receives per-row state and returns a ReactNode.
   * Default: returns `<Text color="cyan">❯ </Text>` when highlighted, `<Text>  </Text>` (two spaces) otherwise.
   */
  indicator?: (props: { isHighlighted: boolean; isDisabled: boolean }) => ReactNode;
}
```

### `<Spinner>`

```tsx
import { Spinner } from '@pilates/widgets';

type SpinnerType = 'dots' | 'line' | 'arrow' | 'bouncingBar' | 'bouncingBall';

interface SpinnerProps {
  /** Default 'dots'. Ignored if `frames` is provided. */
  type?: SpinnerType;
  /** Custom frame array. Overrides `type`. */
  frames?: string[];
  /** ms between frames. Default 80. */
  interval?: number;
}
```

## Behavior

### TextInput

**State.** Internal cursor index (0 ≤ cursor ≤ value.length). The value itself is parent-owned.

**Key bindings (handled inside the widget's own `useInput`):**

| Input | Action |
|---|---|
| Printable char (`event.ch`, no `ctrl`/`alt`) | Insert at cursor; cursor++ |
| `backspace` | Delete char before cursor; cursor-- (no-op at start) |
| `delete` | Delete char at cursor (no-op at end) |
| `left` / `right` | Move cursor by 1 (clamped) |
| `home` / `ctrl+a` | Cursor to 0 |
| `end` / `ctrl+e` | Cursor to value.length |
| `ctrl+u` | Delete from cursor to start; cursor → 0 |
| `ctrl+k` | Delete from cursor to end |
| `ctrl+w` | Delete word backward (boundary: contiguous whitespace) |
| `enter` | `onSubmit(value)` if provided; otherwise no-op |
| Anything else (up, down, escape, F-keys, etc.) | Ignored (no-op) |

**Rendering.** Three flat `<Text>` segments composing horizontally:
- `prefix` = `value.slice(0, cursor)` (or its masked form)
- `cursorChar` = the char at `cursor` (or a space if cursor === value.length), rendered with `inverse: true`
- `suffix` = `value.slice(cursor + 1)` (or its masked form)

Empty value + `focus=true` → render only an inverse space.
`focus=false` → render the value (or mask) flat with no cursor.
`value === ''` and `placeholder` set → render placeholder via `<Text dim>`; cursor still draws over the first placeholder cell when focused.

**Mask validation.** `mask.length !== 1` (UTF-16 code units) throws on render. This rejects multi-byte graphemes (emoji, CJK), which is consistent with the v0.1 limitation noted under multi-byte handling — passwords are typically masked with `'*'` or `'•'` (single BMP code unit) so this is not a real constraint. Throwing in render is acceptable: it's a developer error, not a runtime user error.

### Select

**State.** Internal `highlightIndex`. Initialized from `initialIndex` (default 0), then clamped forward to the first non-disabled item.

**Key bindings:**

| Input | Action |
|---|---|
| `up` | Move highlight to previous non-disabled item (wrap-around) |
| `down` | Move highlight to next non-disabled item (wrap-around) |
| `home` | Highlight first non-disabled item |
| `end` | Highlight last non-disabled item |
| `enter` | `onSelect(items[highlightIndex])` if not disabled; no-op if disabled |
| Anything else | Ignored |

`onHighlight` fires whenever `highlightIndex` changes (after the first commit, not on initial mount).

**Wrap-around** is the convention in `ink-select-input` and most TUI selects (Bubbletea, fzf). Keep it.

**All-disabled edge case:** if every item is disabled, no item is highlighted, no indicator is shown, `enter` is a no-op. Component still renders (so consumers can show a "no options available" state via the `items` array — a single disabled item with that label is fine).

**Indicator default:** highlighted rows get `<Text color="cyan">❯ </Text>`, non-highlighted rows get `<Text>  </Text>` (two spaces). Disabled items get the non-highlighted indicator and `<Text dim>` styling on the label. (Pilates' `Text` uses `dim` rather than Ink's `dimColor`.)

### Spinner

**State.** Frame index. Driven by `useEffect` with `setInterval`; cleared on unmount and on `frames` / `type` / `interval` change.

**Rendering.** A single `<Text>{frames[i]}</Text>`. No `<Box>` wrapper, so consumers compose layout themselves:

```tsx
<Box>
  <Spinner /> <Text> Loading…</Text>
</Box>
```

**Frame catalog (`spinner-frames.ts`):**

```ts
export const SPINNER_FRAMES = {
  dots: ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'],
  line: ['-','\\','|','/'],
  arrow: ['←','↖','↑','↗','→','↘','↓','↙'],
  bouncingBar: ['[    ]','[=   ]','[==  ]','[=== ]','[ ===]','[  ==]','[   =]','[    ]','[   =]','[  ==]','[ ===]','[====]','[=== ]','[==  ]','[=   ]'],
  bouncingBall: ['( ●    )','(  ●   )','(   ●  )','(    ● )','(     ●)','(    ● )','(   ●  )','(  ●   )','( ●    )','(●     )'],
};
```

Total frame catalog ~1KB. Users wanting more (e.g. emoji, 3D cube animations) pass their own `frames` array.

## Edge cases & decisions

- **Multi-byte characters in TextInput.** Cursor and slice operations index by JS `string` units (UTF-16 code units, matching what `KeyEvent.ch` produces). CJK / emoji that require surrogate pairs may render as two cursor stops; this matches the v0.1 limitation in `@pilates/render` (no grapheme cluster handling). Document and accept; revisit when render gains grapheme support.
- **Re-entrant `onChange` / `onSelect`.** If a consumer's `onChange` synchronously triggers a parent re-render with a different `value`, the widget's cursor stays where it was (relative index). If the new value is shorter than `cursor`, clamp `cursor` to `value.length` on render.
- **Two `<TextInput>`s rendered together.** Both subscribe to keystrokes (no focus context). Consumers gate which one receives input via the `focus` prop, typically a piece of parent state.
- **Spinner during render quiescence.** No special handling — `setInterval` fires regardless. The reconciler diffs only the changed frame, which renders one cell.
- **Unmount during pending interval.** `useEffect` cleanup clears the interval. No leaked timers.
- **`items` length 0.** Component renders nothing (an empty `<Box>`). `enter` is a no-op. `onHighlight` is never called.

## Testing

Reuse `@pilates/react`'s render-to-string testing pattern (same approach as `useInput` integration tests in v0.2): mount the widget under a test wrapper, drive synthetic `KeyEvent`s through a fake stdin, assert rendered output and callback invocations.

**Coverage targets:**

| Widget | Test buckets | Approx count |
|---|---|---|
| TextInput | Rendering (placeholder, mask, focus on/off, cursor positions), key bindings (each entry in the table), onSubmit, edit re-entrancy, multi-byte handling | ~16 |
| Select | Rendering (highlight, disabled, custom indicator, all-disabled, empty), navigation (up/down/home/end with skip + wrap), onSelect / onHighlight, indicator function | ~15 |
| Spinner | Frame cycling, type lookup, custom frames, custom interval, cleanup on unmount, type/frames/interval change | ~7 |

Target: ~38 new tests, bringing the workspace total to ~343.

## Release & versioning

- **Initial publish:** `@pilates/widgets@0.1.0-rc.1`. Matches the established RC pattern (`@pilates/react` did `0.1.0-rc.1` → `0.2.0`).
- **Bake period:** 1-2 weeks. Promote to `0.1.0` if no blocking issues land.
- **Per-package tags:** `@pilates/widgets@0.1.0-rc.1` etc., matching the convention.
- **Publish discipline:** never from repo root (root `package.json` has `private: true`). Always `cd packages/widgets`, `pwd`, then `pnpm publish --access=public --no-git-checks`.
- **Phase ordering:** ships after Phase A.5 (core/render → 1.0.0), so widgets always builds on a stable foundation. Per STRATEGY.md, that gate opens 2026-05-13.

## Out of scope (explicit)

- **`<MultiSelect>`** — v0.2+ on demand. Shares ~80% of design with `<Select>`; deferring is cheap.
- **`<Table>`** — v0.2+ on demand. Largest API surface in the candidate set; benefits most from real user signal before locking.
- **`<Confirm>` / yes-no prompt** — trivially built from `<Select>` with two items. Ship as a doc snippet, not a widget.
- **Type-ahead matching in Select** — defer until a user requests it with a concrete spec.
- **`limit` / scrollable Select** — defer indefinitely.
- **Multi-line TextInput, history recall, autocomplete** — readline territory, not widget territory.
- **Focus management / `useFocus`** — separate concern, separately tracked in STRATEGY.md.
- **Form composition primitives** — emerges naturally from focus management; build that first if demanded.

## Open questions deferred to plan/implementation

- **Indicator default character (`❯`).** Confirmed visually on common terminals during implementation; fall back to `>` if rendering issues surface in the bake period.
- **`backspace` key normalization.** Some terminals send DEL (0x7F) for the backspace key; the v0.2 key parser already maps both to `name: 'backspace'`. Verify in tests.
- **`Text`-in-`Text` composition for the cursor split.** STRATEGY.md notes nested-`<Text>` style inheritance is a v0.1 limitation. The cursor render uses *adjacent* text segments inside a row, not nested ones — should work, but verify in the first implementation iteration. If adjacency fails, fall back to a single `<Text>` with the cursor character first and reposition via column flex.
