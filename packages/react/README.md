<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/pilatesjs/pilates/main/assets/logo-dark.svg">
  <img src="https://raw.githubusercontent.com/pilatesjs/pilates/main/assets/logo.svg" alt="pilates" width="48">
</picture>

# @pilates/react

> React reconciler for terminal UIs. Author with JSX, components, and hooks
> on top of [`@pilates/core`](../core) layout, [`@pilates/render`](../render)
> output, and [`@pilates/diff`](../diff) incremental redraws.

## Install

```bash
npm install @pilates/react react@^19
```

`react@^19` is a peer dependency. The reconciler runtime, layout engine,
text shaping, frame buffer, and diff loop are pulled in transitively.

## Quick start

```tsx
import { useEffect, useState } from 'react';
import { Box, render, Text, useApp } from '@pilates/react';

function Counter() {
  const [n, setN] = useState(0);
  const { exit } = useApp();
  useEffect(() => {
    const id = setInterval(() => setN((x) => x + 1), 250);
    const stop = setTimeout(exit, 3000);
    return () => {
      clearInterval(id);
      clearTimeout(stop);
    };
  }, [exit]);
  return (
    <Box border="single" padding={1} width={20} height={5} flexDirection="column">
      <Text bold color="cyan">counter</Text>
      <Text>n = {n}</Text>
    </Box>
  );
}

const instance = render(<Counter />);
await instance.waitUntilExit();
```

`render()` returns a handle with `unmount()` and `waitUntilExit()`. The
reconciler subscribes to `process.stdout` SIGWINCH so the layout
recomputes when the terminal is resized.

## Components

| Component | Purpose |
|---|---|
| `<Box>`     | Layout container — every prop on `@pilates/render`'s `LayoutProps` and `BorderProps` is accepted (`flexDirection`, `flex`, `width`, `height`, `padding`, `margin`, `gap`, `justifyContent`, `alignItems`, `border`, `borderColor`, `title`, `titleColor`, …). |
| `<Text>`    | Styled text leaf. Accepts `color`, `bgColor`, `bold`, `italic`, `underline`, `dim`, `inverse`, `wrap`. Children must be strings, numbers, nested `<Text>`, or a literal `'\n'` (or `<Newline />`). |
| `<Spacer>`  | Sugar for `<Box flexGrow={1} />` — pushes siblings apart in a row/column. |
| `<Newline>` | Returns `'\n'`. Use when you'd otherwise reach for a string literal inside `<Text>`. |

`<Text>` deliberately rejects `<Box>` children — embedding a flex container
inside a text run has no meaningful layout. The reconciler throws on
mount with a message that points at the offending tree.

## Hooks

```ts
import {
  useApp, useInput, usePaste, useFocus, useFocusManager,
  useStdout, useStderr, useWindowSize,
} from '@pilates/react';

const { exit } = useApp();                     // exit(error?: Error) tears down the render
const { columns, rows } = useStdout();         // tracks SIGWINCH; re-renders on resize
const { columns, rows } = useWindowSize();     // shorthand for just the dimensions
const { write }        = useStderr();          // direct stderr access for log-style output
useInput((event) => { /* ... */ });            // subscribe to keystrokes
usePaste((text) => { /* ... */ });             // subscribe to bracketed-paste payloads
const { isFocused, focus } = useFocus({ id: 'name', autoFocus: true });
const manager = useFocusManager();             // focusedId, focusNext, disableFocus, …
```

| Hook | Returns | Notes |
|---|---|---|
| `useApp()` | `{ exit(error?) }` | `exit()` resolves the `waitUntilExit()` promise; `exit(err)` rejects it. |
| `useStdout()` | `{ stdout, write, columns, rows }` | `columns`/`rows` update on `'resize'`. `write` is a typed shorthand for `stdout.write`. |
| `useWindowSize()` | `{ columns, rows }` | Convenience over `useStdout()` when you only need dimensions. Same resize behavior. |
| `useStderr()` | `{ stderr, write }` | Use for log lines that should NOT participate in the diff loop. |
| `useInput()` | `void` | Subscribe to keystrokes. `event.name` for arrows / specials, `event.ch` for printable, modifiers via `event.ctrl/alt/shift`. Lazy raw-mode lifecycle — stdin is untouched if no useInput is mounted. Pass `{ isActive: false }` to opt a handler out without unsubscribing. |
| `usePaste()` | `void` | Subscribe to xterm bracketed-paste payloads (DEC mode 2004). The handler receives the entire pasted text in one call (newlines / control bytes preserved), so a multi-line paste does NOT fire Enter on every newline through `useInput`. Activates raw mode on its own; pairs with the lazy `\x1b[?2004h` / `\x1b[?2004l` lifecycle. |
| `useFocus({ id?, autoFocus?, isActive? })` | `{ isFocused, focus, blur, id }` | Register the calling component as a Tab-cycle target. `autoFocus` is first-wins-in-commit-order; `id` defaults to `useId()`. Gate `useInput` on `isFocused` to act on keystrokes only when this component holds focus. |
| `useFocusManager()` | `{ focusedId, focus(id), focusNext, focusPrevious, enableFocus, disableFocus, isEnabled }` | Imperative control over the focus cycle. `disableFocus({ blur: true })` clears the current focus; the default keeps it pinned so `enableFocus()` resumes where it left off. |

All hooks throw if called outside a `<render>` tree.

### useInput example

```tsx
import { useState } from 'react';
import { Box, render, Text, useApp, useInput } from '@pilates/react';

function Wizard() {
  const [step, setStep] = useState(0);
  const { exit } = useApp();
  useInput((event) => {
    if (event.name === 'right' || event.ch === 'n') setStep((s) => Math.min(s + 1, 2));
    if (event.name === 'left'  || event.ch === 'p') setStep((s) => Math.max(s - 1, 0));
    if (event.ch === 'q' || event.name === 'escape') exit();
    if (event.ctrl && event.ch === 'c') exit();
  });
  return (
    <Box border="single" padding={1}>
      <Text>step {step + 1}/3 — n/p to navigate, q to quit</Text>
    </Box>
  );
}

await render(<Wizard />).waitUntilExit();
```

The `KeyEvent` shape:

```ts
interface KeyEvent {
  name?: KeyName;   // 'enter' | 'escape' | 'tab' | 'backspace' | 'delete' | 'space'
                    // | 'up' | 'down' | 'left' | 'right' | 'home' | 'end'
                    // | 'pageUp' | 'pageDown' | 'f1' | … | 'f12'
  ch?: string;      // printable Unicode char (multi-byte CJK / emoji passes through)
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  sequence: string; // raw input bytes
}
```

### useFocus example

`<FocusProvider>` is auto-installed by `render()` — Tab cycles forward
through registered focusables, Shift+Tab cycles backward. Opt out with
`render(elem, { focus: false })` to free Tab for your own handlers.

```tsx
import { useState } from 'react';
import { render, Box, Text, useFocus, useInput } from '@pilates/react';

function Field({ id, label }: { id: string; label: string }) {
  const { isFocused } = useFocus({ id, autoFocus: id === 'name' });
  const [value, setValue] = useState('');
  useInput((event) => {
    if (event.ch) setValue((v) => v + event.ch);
    if (event.name === 'backspace') setValue((v) => v.slice(0, -1));
  }, { isActive: isFocused });
  return (
    <Box border={isFocused ? 'double' : 'single'} padding={1}>
      <Text>{label}: {value || '…'}</Text>
    </Box>
  );
}

render(
  <Box flexDirection="column" gap={1}>
    <Field id="name"  label="Name" />
    <Field id="email" label="Email" />
    <Text dim>Tab / Shift+Tab to switch fields</Text>
  </Box>,
);
```

Use `useFocusManager()` to drive cycling programmatically (`focus(id)`,
`focusNext()`, `focusPrevious()`) or to suspend Tab handling
(`disableFocus()` / `enableFocus()`).

## useBoxMetrics

Read the most recent computed layout (left / top / width / height) of a
`<Box>` referenced by a ref. Useful for animation, popover positioning,
custom virtualization, or responsive UI that adapts to its container's
actual measured size.

```tsx
import { useRef } from 'react';
import { Box, Text, useBoxMetrics } from '@pilates/react';

function ResponsivePanel() {
  const ref = useRef(null);
  const m = useBoxMetrics(ref);
  return (
    <Box ref={ref} flexGrow={1}>
      <Text>{m ? `${m.width}×${m.height}` : 'measuring…'}</Text>
    </Box>
  );
}
```

Returns `null` until the ref attaches and the first layout pass
completes. Re-renders when (a) the terminal resizes (SIGWINCH, via the
shared `useStdout` dependency) or (b) any commit produces a different
layout for this Box. The implementation skips updates when the layout
key is unchanged, so a `useBoxMetrics` consumer doesn't loop.

`<Text ref={...}>` is also supported, but the Text-instance shape is
internal and the hook narrows for `<Box>` only — if you need text
metrics, measure via `stringWidth` / `wrapText` from `@pilates/core`.

## Theming

Wrap a subtree in `<ThemeProvider>` to override the active palette of
semantic color tokens (`primary`, `error`, `success`, etc.). Components
that opt in via `useTheme()` get the active values; ones that don't
keep using whatever color they have hardcoded.

```tsx
import { ThemeProvider, useTheme, lightTheme, Text, Box } from '@pilates/react';

function Banner({ kind, children }: { kind: 'info' | 'error'; children: string }) {
  const t = useTheme();
  return <Text color={kind === 'error' ? t.error : t.info}>{children}</Text>;
}

<ThemeProvider theme={lightTheme}>
  <App />
  <ThemeProvider theme={{ error: 'red' }}>
    <DangerZone />            {/* error overridden, all other tokens inherit */}
  </ThemeProvider>
</ThemeProvider>
```

`<ThemeProvider>` accepts either a full `Theme` or a `Partial<Theme>` —
partial overrides merge over the parent (or `defaultTheme` if no parent
provider is present). Nested providers compose the same way.

`useTheme()` is opt-in: calling it outside any `<ThemeProvider>` returns
`defaultTheme` rather than throwing, so simple apps can adopt theming
incrementally.

| Token | Intent |
|---|---|
| `primary` | Brand main — active tabs, primary CTA, focused field marker |
| `accent` | Brand secondary — hover-equivalent, supplementary highlights |
| `text` | Default body text |
| `muted` | De-emphasized text — placeholders, disabled rows, captions |
| `success` | Confirmations, positive state |
| `warning` | Caution, lossy operations |
| `error` | Failures, destructive actions |
| `info` | Neutral notifications, hints |
| `border` | Box / panel borders |

Two themes ship out of the box — `defaultTheme` (tuned for dark
terminals — the Linux / macOS default) and `lightTheme` (legible on
light backgrounds).

## Error boundaries

Wrap a subtree in `<ErrorBoundary>` to catch render-phase throws without
crashing the rest of the tree. Sibling subtrees outside the boundary
continue rendering. The default fallback is a single bold-red line —
`Render error: <message>` — sized to fit any viewport.

```tsx
import { ErrorBoundary, Box, Text } from '@pilates/react';

<ErrorBoundary
  fallback={(err, reset) => (
    <Box flexDirection="column">
      <Text color="red">{err.message}</Text>
      <Text dim>Press R to retry</Text>
    </Box>
  )}
  onError={(err, info) => log.error(err, info)}
  resetKeys={[currentRoute]}
>
  <App />
</ErrorBoundary>
```

| Prop | Notes |
|---|---|
| `fallback` | `ReactNode` (static) or `(error, reset) => ReactNode`. Defaults to a one-line `Render error: …` panel. |
| `onError` | Called once per caught error with `(error, info)` where `info.componentStack` is provided by react-reconciler. Throws here are swallowed. |
| `resetKeys` | When any element of this array changes (referential `!==`), the boundary clears its caught error and re-mounts children. Use to recover after the upstream cause has been fixed. |
| `reset()` | Passed as the second arg to function fallbacks. Calling it clears the error. |

ErrorBoundary catches render-phase errors only (the standard React
contract). Async errors and event-handler throws need their own try/catch
or a higher-level hook like `useApp().exit(err)`.

## Error handling

`@pilates/react` throws `PilatesError` for every framework-level invariant.
Errors carry a stable `code`, optional dev-only `hint`, structured `meta`,
and a `componentStack` populated by the reconciler when a render-time error
is caught.

### Discriminating errors

Prefer the `isPilatesError` guard over `instanceof PilatesError`. It uses a
`Symbol.for('pilates.error')` tag that survives multiple copies of the
library being loaded into the same process (pnpm hoisting / dual-publish
edge cases):

```ts
import { isPilatesError, PilatesErrorCode } from '@pilates/react';

try {
  // ...
} catch (e) {
  if (isPilatesError(e) && e.code === PilatesErrorCode.HookOutsideRender) {
    // recover
  }
}
```

### SemVer policy

| Surface | Stable? |
|---|---|
| `error.code` (the string ID) | **Yes** — renaming a code is a major-version change |
| `error instanceof PilatesError` / `isPilatesError(e)` | **Yes** |
| Structured fields: `code`, `meta`, `componentStack`, `ownerStack` | **Yes** — adding new optional fields is non-breaking |
| `toJSON()` output shape | **Yes** — adding new optional keys is non-breaking |
| `error.message` text | **No** — may be reworded freely |
| `error.hint` text and presence | **No** — dev-only, may be reworded freely |
| Stack-trace formatting | **No** |

This matches the policy used by Node core's error API.

### Error code reference

| Code | Thrown from |
|---|---|
| `PILATES_HOOK_OUTSIDE_RENDER` | `useApp`, `useStdout`, `useStderr`, `usePaste`, `useInput`, `useFocus`, `useFocusManager` outside a `render()`-mounted tree |
| `PILATES_FOCUS_OUTSIDE_PROVIDER` | `useFocus()` outside `<FocusProvider>` |
| `PILATES_DUPLICATE_FOCUS_ID` | Two simultaneous `useFocus({ id })` calls with the same id |
| `PILATES_FOCUS_ID_NOT_FOUND` | `useFocusManager().focus(id)` called with an unregistered id |
| `PILATES_FOCUS_INPUT_BRIDGE_OUTSIDE_PROVIDER` | Internal — indicates a corrupted install if user-visible |
| `PILATES_UNKNOWN_HOST_TYPE` | JSX with a host element that isn't a Pilates component (e.g. `<div>`) |
| `PILATES_BARE_STRING_AT_ROOT` | A raw string at the `<render>` root |
| `PILATES_BARE_STRING_IN_BOX` | A raw string as a `<Box>` child |
| `PILATES_STRING_FRAGMENT_INVARIANT` | Internal invariant — file an issue if you hit one |
| `PILATES_INVALID_TEXT_CHILD` | A non-string, non-`<Text>` child of `<Text>` |
| `PILATES_TEXTINPUT_BAD_PROP` | `<TextInput>` received a malformed prop |

### Format helpers

`formatPilatesError(err)` returns a multi-line string suitable for printing
into the terminal: `Pilates: <message>` followed by an indented `hint:` line
(in dev mode) and a `caused by:` chain (recursive on `error.cause`):

```ts
import { formatPilatesError } from '@pilates/react';

try {
  // ...
} catch (e) {
  console.error(formatPilatesError(e));
}
```

### Source maps

Pilates emits `.js.map` alongside its compiled output. Run your app with
`node --enable-source-maps your-cli.js` to make stack traces point at the
original `.ts` source rather than the published `dist/` files. Pilates
deliberately does **not** bundle a runtime `source-map-support` patch: a
library mutating `Error.prepareStackTrace` is hostile to its host.

## render() options

```ts
render(<App />, {
  width?: number,                  // override stdout.columns
  height?: number,                 // override stdout.rows
  stdout?: NodeJS.WriteStream,     // defaults to process.stdout
  stderr?: NodeJS.WriteStream,     // defaults to process.stderr
  stdin?: NodeJS.ReadStream,       // defaults to process.stdin (used when useInput is mounted)
});
```

The returned `RenderInstance`:

- `unmount()` — tear down the React tree, write a final SGR reset + newline
  so the next shell prompt lands on a clean line, and resolve `waitUntilExit()`.
- `waitUntilExit()` — Promise that resolves on a clean exit and rejects on
  `useApp().exit(error)`, an uncaught render error, or a stdout `'error'`
  event (e.g. `EPIPE`).

## How it draws

Each commit re-runs `@pilates/render`'s layout, diffs the new frame against
the previous one via `@pilates/diff`, and writes only the changed cells'
ANSI cursor moves + SGR + characters. A re-render with no visible change
emits zero bytes. A `setState` that flips one character emits one cursor
move and one character.

On SIGWINCH the layout root's dimensions are mutated and `prevFrame` is
cleared, forcing a full repaint at the new size — anything else would
leave stale cells past the new viewport.

## Testing

`@pilates/react/test-utils` ships helpers for unit-testing components
without spawning a real terminal:

| Helper | Returns | Use for |
|---|---|---|
| `renderToString(<App />, { width, height })` | `string` (frame as text + SGR) | Static-tree assertions; no input, no setState. |
| `mount(initial, render, { width, height })` | `MountHandle<T>` | Components that update via `setState`. Wraps reconciler ops in `act()`; drains passive effects. |
| `mountWithInput(initial, render, { width, height })` | `InputMountHandle<T>` | Components using `useInput`. Adds `pressKey()` / `pressChar()` / `pressCtrl()` and a `fakeStdin` for lifecycle assertions. |
| `snapshot(out)` | `{ ansi, plain }` | Two-shot snapshot testing — one snapshot with SGR + cursor codes, one stripped for layout-only drift. |
| `makeFakeStdin()` | `FakeStdin` | Lower-level stdin double if you need to drive bytes directly. |

Snapshot pattern (Vitest):

```tsx
import { mountWithInput, snapshot } from '@pilates/react/test-utils';
import { expect, it } from 'vitest';
import { Spinner } from '@pilates/widgets';

it('renders the dots spinner', () => {
  const h = mountWithInput(0, () => <Spinner type="dots" />, { width: 4, height: 1 });
  const s = snapshot(h.lastWrite());
  expect(s.ansi).toMatchSnapshot('ansi');   // catches color / cursor drift
  expect(s.plain).toMatchSnapshot('plain'); // catches layout drift
  h.unmount();
});
```

Two snapshots per scene make regressions easier to localize: if `ansi`
diffs but `plain` doesn't, the regression is in the styling layer; if
both diff, layout shifted too.

## What's NOT in v0.2

The following are intentionally deferred. See `docs/STRATEGY.md` for the
roadmap that maps each item to a specific phase.

- **`useFocus()` / `<FocusManager>`** — focus traversal across components.
  Phase 3, after a separate `@pilates/widgets` package surfaces real
  multi-input form requirements.
- **`<Static>`** — append-only output above the live region.
- **`<Transform>`** — character-level transforms applied at paint time.
- **Bracketed paste mode** and **Kitty keyboard protocol** extended
  encoding — v0.3 if requested. v0.2 reads xterm-compatible CSI only.
- **Mouse events** — permanently out of scope (see strategy doc).
- **Nested `<Text>` style inheritance** — child `<Text>` styles are dropped
  during text flatten; only text content propagates upward. Use one
  `<Text>` per styled run.
- **Concurrent mode** — `render()` uses LegacyRoot so commits flush
  synchronously; `useTransition` and similar concurrent APIs may behave
  unexpectedly.

If you need any of the deferred items, an issue with your use case is
welcome — demand drives the roadmap.

## Examples

Three runnable apps live under `examples/` in the repo:

- `react-counter` — interval-driven setState, exits cleanly via `useApp`.
- `react-dashboard` — header/footer/tile grid that responds to resize.
- `react-modal` — absolutely-positioned overlay with toggle state.

```bash
pnpm --filter @pilates-examples/react-counter dev
pnpm --filter @pilates-examples/react-dashboard dev
pnpm --filter @pilates-examples/react-modal dev
```

## Status

`0.2.0` — first non-RC release. Bug reports and API feedback go to
[the issue tracker](https://github.com/pilatesjs/pilates/issues).

## License

MIT
