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
import { useApp, useInput, useStdout, useStderr, useWindowSize } from '@pilates/react';

const { exit } = useApp();                     // exit(error?: Error) tears down the render
const { columns, rows } = useStdout();         // tracks SIGWINCH; re-renders on resize
const { columns, rows } = useWindowSize();     // shorthand for just the dimensions
const { write }        = useStderr();          // direct stderr access for log-style output
useInput((event) => { /* ... */ });            // subscribe to keystrokes
```

| Hook | Returns | Notes |
|---|---|---|
| `useApp()` | `{ exit(error?) }` | `exit()` resolves the `waitUntilExit()` promise; `exit(err)` rejects it. |
| `useStdout()` | `{ stdout, write, columns, rows }` | `columns`/`rows` update on `'resize'`. `write` is a typed shorthand for `stdout.write`. |
| `useWindowSize()` | `{ columns, rows }` | Convenience over `useStdout()` when you only need dimensions. Same resize behavior. |
| `useStderr()` | `{ stderr, write }` | Use for log lines that should NOT participate in the diff loop. |
| `useInput()` | `void` | Subscribe to keystrokes. `event.name` for arrows / specials, `event.ch` for printable, modifiers via `event.ctrl/alt/shift`. Lazy raw-mode lifecycle — stdin is untouched if no useInput is mounted. Pass `{ isActive: false }` to opt a handler out without unsubscribing. |

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
