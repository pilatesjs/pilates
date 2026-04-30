# `useInput` — design

**Date:** 2026-04-30
**Status:** Approved (brainstorming complete; pending plan)
**Target release:** `@pilates/react@0.2.0`
**Supersedes:** the v0.1 spec's deferral of `useInput` to "v2"; per `docs/STRATEGY.md` Phase 1, input handling is now Phase 1 / `0.2.0` work.

## Goal

Add a `useInput` hook to `@pilates/react` so applications can respond to keystrokes — the missing primitive that gates the package from powering interactive CLIs (wizards, menus, prompts, TUI forms).

Without `useInput`, `@pilates/react` only powers "watch this tick" displays (counters, dashboards, status). Closing this gap is the single highest-impact addition for the package's adoption.

## Strategic decisions (locked)

| Decision | Choice | Rationale |
|---|---|---|
| Hook signature | `useInput(handler: (event: KeyEvent) => void, options?: UseInputOptions)` — modern, single discriminated event | Matches Textual / ratatui / Bubbletea / DOM `KeyboardEvent` conventions. The Ink-style `(input, key)` bag-of-booleans is a 2018 React-conventions artifact; "Ink-compatible names" applies to component / hook names, not signatures (per `docs/STRATEGY.md` decision rule 5). |
| Focus model | None in v0.2 — broadcast every keypress to every active subscriber | Matches Ink's own evolution (useInput shipped first, useFocus came later in response to real demand). Defer focus until use cases drive the API. |
| Raw mode lifecycle | Lazy — enter on first `useInput` mount, exit on last unmount | Apps without `useInput` never touch stdin. Preserves stdin for non-interactive workflows. |
| Stdin plumbing | `StdinContext` + `StdinProvider`, parallel to existing `StdoutContext`/`StdoutProvider` | Testable (fake stdin via context), consistent with the existing wrapper-component pattern. |
| Key parser | Roll our own (~150 LOC state machine, pure function) | Avoids a runtime dep; the encoding subset we need is small and well-defined; xterm-compatible only. |
| Encoding scope | xterm-compatible CSI sequences only | Bracketed paste, mouse, kitty keyboard protocol all explicitly out for v0.2. |
| Subscriber dispatch | Broadcast to every active subscriber, in mount order | Simplest dispatch model; apps filter inside their handler. Order doesn't matter for v0.2 (no focus). |
| `isActive` semantics | False subscribers receive nothing but DON'T decrement raw-mode refcount | Prevents raw-mode toggling on every prop flip. |

## Architecture

### Package additions

```
packages/react/src/
├── components.tsx              (unchanged)
├── host-config.ts              (unchanged)
├── hooks.ts                    + useInput, KeyEvent, KeyName, UseInputOptions
├── index.ts                    + export { useInput, type KeyEvent, type KeyName, type UseInputOptions }
├── key-parser.ts               NEW — pure function bytes → KeyEvent[]
├── reconciler.ts               (unchanged)
├── render.tsx                  + StdinProvider in the wrapper chain
├── render.test.tsx             + ~25 new tests in 5 buckets
└── test-utils.ts               + mountWithInput<T>(), InputMountHandle<T>
```

No new top-level packages. The reconciler and host-config are untouched — input is a layer on top of the existing tree.

### Module roles

- `key-parser.ts` — pure synchronous function: `parse(buffer: Buffer | string): { events: KeyEvent[]; remainder: string }`. Stateless across calls; the caller is responsible for buffering partial sequences across `'data'` chunks (parser returns whatever bytes it couldn't yet decode).
- `hooks.ts` — exports `useInput` as a thin wrapper over `useContext(StdinContext) + useEffect`. Adds `StdinContext` and `StdinHookValue`.
- `render.tsx` — owns `StdinProvider`, which manages the subscriber list, raw-mode refcount, and the `'data'` listener that pumps bytes through the parser.
- `test-utils.ts` — adds `mountWithInput` and dispatch helpers. The test `StdinProvider` accepts a fake event-emitter stdin so tests can fabricate keystrokes without touching the real stdin.

## Public API surface

### Types

```ts
export type KeyName =
  | 'enter' | 'escape' | 'tab' | 'backspace' | 'delete'
  | 'up' | 'down' | 'left' | 'right'
  | 'pageUp' | 'pageDown' | 'home' | 'end'
  | 'space'
  | 'f1' | 'f2' | 'f3' | 'f4' | 'f5' | 'f6'
  | 'f7' | 'f8' | 'f9' | 'f10' | 'f11' | 'f12';

export interface KeyEvent {
  /** Semantic key name when one applies. Mutually exclusive with `ch` for non-printables. */
  name?: KeyName;
  /** Printable Unicode character (one code point; multi-byte CJK / emoji passes through unchanged). undefined for non-printables. */
  ch?: string;
  /** Modifier states. */
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  /** Raw input bytes for power users who need to bypass the parser (e.g., custom terminal extensions). */
  sequence: string;
}

export interface UseInputOptions {
  /** When false, the handler does not receive keystrokes. Defaults to true. */
  isActive?: boolean;
}
```

### Hook

```ts
export function useInput(
  handler: (event: KeyEvent) => void,
  options?: UseInputOptions,
): void;
```

### Usage

```tsx
import { Box, render, Text, useApp, useInput, useState } from '@pilates/react';

function Counter() {
  const [n, setN] = useState(0);
  const { exit } = useApp();
  useInput((event) => {
    if (event.name === 'up') setN((x) => x + 1);
    if (event.name === 'down') setN((x) => x - 1);
    if (event.ch === 'q' || event.name === 'escape') exit();
    if (event.ctrl && event.ch === 'c') exit();
  });
  return (
    <Box border="single" padding={1}>
      <Text>n = {n} (↑/↓ to change, q to quit)</Text>
    </Box>
  );
}

await render(<Counter />).waitUntilExit();
```

## Data flow

```
process.stdin
  │ 'data' (Buffer chunk, e.g. "\x1b[A")
  ▼
StdinProvider's onData
  │ append to leftover buffer
  ▼
key-parser.parse(buffer)
  │ → { events: KeyEvent[], remainder: string }
  │ remainder is stored back on the Provider for the next chunk
  ▼
for each event:
   for each active subscriber (insertion order):
     try { handler(event) } catch (e) { log to stderr; continue }
  │
  ▼
React commits any setState calls via the existing
DiscreteEventPriority + flushSyncWork machinery.
```

## Lifecycle / raw mode

```
StdinProvider state: { subscribers: Set<Handler>; rawModeOwners: number; remainder: string }

useInput mount  → subscribers.add(handler);   if isActive: incRefcount()
useInput unmount → subscribers.delete(handler); if was-active: decRefcount()
isActive: true→false → decRefcount()  (handler still in set, just won't be called)
isActive: false→true → incRefcount()

incRefcount(): if 0 → 1, enter raw mode + attach 'data' listener
decRefcount(): if 1 → 0, detach 'data' + exit raw mode

render() unmount: forcibly clear subscribers, exit raw mode if engaged
```

Edge cases handled:

- **Non-TTY stdin** (`stdin.isTTY === false`): skip `setRawMode` (it would throw), but still attach the `'data'` listener — supports tests + scripted input.
- **`setRawMode` throws** for any reason: catch, log a one-time warning to stderr, continue without raw mode.
- **Already-resumed stdin**: `stdin.resume()` is idempotent; safe to call.
- **Concurrent mounts in same render tick**: subscribers added in order; raw mode entered exactly once on the 0→1 transition.

## Key parser scope

### In scope (must decode correctly)

| Input | KeyEvent |
|---|---|
| `a`, `Z`, `1`, ` ` (printable ASCII) | `{ ch, ctrl: false, alt: false, shift: false }` (`shift` reflects letter case for ASCII letters; explicit Shift for symbols isn't reliably detectable) |
| Multi-byte UTF-8 (CJK, emoji) | `{ ch }` with the full code point as a single string |
| `\r`, `\n` | `{ name: 'enter' }` |
| `\t` | `{ name: 'tab' }` |
| `\x7f` or `\x08` | `{ name: 'backspace' }` |
| `\x1b` (lone ESC, not followed within ~50ms) | `{ name: 'escape' }` |
| `\x01..\x1a` (ctrl+a..z) | `{ ch: 'a'..'z', ctrl: true }` |
| `\x1b<char>` (ESC + char) | `{ ch: <char>, alt: true }` (also covers `alt+letter`) |
| `\x1b[A`, `[B`, `[C`, `[D` | `{ name: 'up' \| 'down' \| 'right' \| 'left' }` |
| `\x1b[H`, `[F` | `{ name: 'home' \| 'end' }` |
| `\x1b[5~`, `[6~` | `{ name: 'pageUp' \| 'pageDown' }` |
| `\x1b[3~` | `{ name: 'delete' }` |
| `\x1bO` + `P..S` (F1–F4) | `{ name: 'f1'..'f4' }` |
| `\x1b[15~`, `[17~`..`[24~` (F5–F12) | `{ name: 'f5'..'f12' }` |
| CSI with modifier param `1;5A` etc. | `{ name: 'up', ctrl: true }` (full xterm modifier-encoding table) |

### Out of scope for v0.2 (deferred or permanent)

- **Bracketed paste mode** (`\x1b[200~ ... \x1b[201~`) — defer to v0.3 if requested. Current behavior: bytes pass through as individual keystrokes (which is what most apps want anyway).
- **Mouse events** (`\x1b[M…`, SGR `\x1b[<…`) — out of scope per `docs/STRATEGY.md` ("no mouse").
- **Kitty keyboard protocol** (`\x1b[u` extended encoding) — defer to v0.3 if Kitty-specific apps surface.
- **Compose key / IME** — terminal handles internally before bytes reach the parser; nothing to do.
- **Lone escape disambiguation timeout** — v0.2 returns `{ name: 'escape' }` immediately on a buffer that ends in `\x1b` after one tick of nothing else arriving. Not a true timeout — apps that want hold-ESC behaviour can layer it on.

### Partial sequences across chunks

The parser is stateless; the caller (`StdinProvider`) maintains a `remainder` string. After each `parse()`:

1. Concatenate `remainder` with new chunk.
2. Call `parse(combined)`.
3. Save `parse().remainder` for next chunk.
4. Dispatch `parse().events`.

If a chunk arrives mid-sequence (e.g., just `\x1b[`), the parser returns an empty `events` array and the full input as `remainder`. The next chunk completes it.

## React-tree integration

Provider chain after this work:

```
AppContext.Provider
  → StdoutProvider
    → ResizeBridge
      → StdinProvider          ← new
        → StderrContext.Provider
          → <user element>
```

`StdinProvider` reads `stdin` from a prop (passed from `render()` via `options.stdin ?? process.stdin`), so the test harness can inject a fake. It does NOT use `useStdout()`'s `stdout` — stdin and stdout are unrelated streams.

`useInput` reads `StdinContext` via `useContext`. Throws "useInput() must be used inside <render>" if no provider is found, matching the existing `useApp` / `useStdout` / `useStderr` pattern.

## Test harness extension

```ts
export interface InputMountHandle<T> extends MountHandle<T> {
  /** Dispatch a fully-specified KeyEvent. */
  press(event: Partial<KeyEvent> & { name?: KeyName; ch?: string }): void;
  /** Convenience: press a named key with no modifiers. */
  pressKey(name: KeyName): void;
  /** Convenience: press a single character with no modifiers. */
  pressChar(ch: string): void;
  /** Convenience: press ctrl+<char>. */
  pressCtrl(ch: string): void;
}

export function mountWithInput<T>(
  initial: T,
  renderFn: (state: T) => ReactElement,
  options: RenderToStringOptions,
): InputMountHandle<T>;
```

Internally, `mountWithInput` constructs a fake stdin (an EventEmitter with `setRawMode`, `resume`, `isTTY: true`) and renders through a chain that includes `StdinProvider`. The `press*` helpers fabricate `KeyEvent`s and dispatch them directly to the Provider's subscribers (bypassing the parser — parser tests run separately as pure unit tests). Each `press` call also invokes `flushSyncWork()` so tests see the post-keypress render synchronously.

## Error handling

| Failure | Behavior |
|---|---|
| `stdin.setRawMode` throws | Catch; emit a single warning to stderr ("Pilates: raw stdin mode not available; keystroke dispatch may be line-buffered"); proceed without raw mode |
| Subscriber handler throws | Catch per-subscriber; log via stderr; other subscribers continue receiving the event |
| stdin emits `'error'` | Routes through the existing `finishUnmount(err)` — same path as stdout `'error'` |
| Parser receives unrecognized CSI | Returns the raw `sequence` as a `KeyEvent` with no `name` and no `ch`, modifiers all false. Apps can still detect via `event.sequence` |
| `process.stdin` is `undefined` (rare; some embedded runtimes) | Skip raw mode, skip listener. `useInput` mounts succeed; events never fire. Logged once |

The render-error and stream-error paths from v0.1 are unchanged.

## Testing

~25 new tests across five buckets:

| Bucket | Approx count | Coverage |
|---|---|---|
| Parser unit (`key-parser.test.ts`) | ~12 | Each encoding: arrows, F1–F12, all CSI modifier combinations, ctrl+letter, alt+letter, multi-byte UTF-8 passthrough, lone ESC, partial sequence across chunks, unrecognized CSI fallthrough |
| Hook integration (`render.test.tsx`) | ~6 | `useInput` receives keypresses; `isActive: false` opts out; multiple subscribers all fire; unmount removes subscriber; mount-during-render receives subsequent events; isActive flip without remounting |
| Lifecycle | ~4 | Raw mode enters on first mount; exits on last unmount; doesn't enter for non-TTY stdin; recovers gracefully when `setRawMode` throws |
| Composition | ~2 | `useInput` inside conditionally rendered components mounts/unmounts cleanly; multiple `useInput` hooks across different subtrees don't interfere |
| End-to-end | ~1 | `render(<App with useInput />)` + simulated keypress + assertion that the rendered ANSI output reflects the resulting state change |

Existing 24 tests must remain green. Total target: 49 tests in `packages/react/`.

## Performance

- Parser allocations: one `KeyEvent` object per keystroke, modifiers as primitives. Subscriber dispatch is a tight `for` loop. Raw-mode lifecycle ops are O(1) with refcount math. No measurable overhead vs. v0.1 for non-input apps (zero `useInput` hooks → stdin untouched).
- The bench harness in `bench/` does not need extension — input handling isn't a layout-engine concern.

## Deferred to later versions

- `useFocus`, `useFocusManager` — Phase 3 if real demand surfaces (per strategy doc, ship widgets first; let multi-input forms drive the focus design)
- Bracketed paste — v0.3 if requested
- Kitty keyboard protocol extended encoding — v0.3 if requested
- Mouse events — permanently out of scope per strategy doc
- Hold-detection for ESC (vs. ESC-as-leader) — v0.3 if requested

## Open questions

None blocking. All decisions in the Strategic Decisions table are locked; everything else flows from them.

## Spec self-review

- **Placeholders:** none. Every section has concrete content.
- **Internal consistency:** the strategic-decisions table, the architecture, and the implementation modules align. The provider chain in §"React-tree integration" matches the lifecycle described in §"Lifecycle / raw mode".
- **Scope:** focused on a single hook plus the supporting plumbing. Fits one implementation plan.
- **Ambiguity:** §"In scope" table for the parser names every encoding pair the parser must handle; §"Out of scope" names everything it must NOT handle. No interpretation room.
