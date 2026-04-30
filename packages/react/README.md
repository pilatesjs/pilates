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
npm install @pilates/react@next react@^19
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
import { useApp, useStdout, useStderr } from '@pilates/react';

const { exit } = useApp();          // exit(error?: Error) tears down the render
const { columns, rows } = useStdout(); // tracks SIGWINCH; re-renders on resize
const { write }        = useStderr();  // direct stderr access for log-style output
```

| Hook | Returns | Notes |
|---|---|---|
| `useApp()` | `{ exit(error?) }` | `exit()` resolves the `waitUntilExit()` promise; `exit(err)` rejects it. |
| `useStdout()` | `{ stdout, write, columns, rows }` | `columns`/`rows` update on `'resize'`. `write` is a typed shorthand for `stdout.write`. |
| `useStderr()` | `{ stderr, write }` | Use for log lines that should NOT participate in the diff loop. |

All three hooks throw if called outside a `<render>` tree.

## render() options

```ts
render(<App />, {
  width?: number,                  // override stdout.columns
  height?: number,                 // override stdout.rows
  stdout?: NodeJS.WriteStream,     // defaults to process.stdout
  stderr?: NodeJS.WriteStream,     // defaults to process.stderr
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

## What's NOT in v0.1

This release covers the core rendering loop only. The following are
intentionally deferred to keep the surface small:

- **`useInput()`** — raw stdin parsing for keyboard events.
- **`useFocus()` / `<FocusManager>`** — focus traversal across components.
- **`<Static>`** — append-only output above the live region.
- **`<Transform>`** — character-level transforms applied at paint time.
- **Nested `<Text>` style inheritance** — child `<Text>` styles are dropped
  during text flatten in v0.1; only text content propagates upward. Use
  one `<Text>` per styled run.
- **Concurrent mode** — `render()` uses LegacyRoot so commits flush
  synchronously; `useTransition` and similar concurrent APIs may behave
  unexpectedly.

If you need any of the above, an issue with your use case is welcome.

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

Pre-release (`0.1.0-rc.1`). Published with the `next` dist-tag — install
with `npm install @pilates/react@next` to opt in. Bug reports and API
feedback go to [the issue tracker](https://github.com/pilatesjs/pilates/issues).

## License

MIT
