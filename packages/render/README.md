<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/pilatesjs/pilates/main/assets/logo-dark.svg">
  <img src="https://raw.githubusercontent.com/pilatesjs/pilates/main/assets/logo.svg" alt="pilates" width="48">
</picture>

# @pilates/render

> Out-of-box renderer for [`@pilates/core`](../core). Declarative POJO tree
> → painted ANSI string with borders, titles, colors, and text wrap.

## Install

```bash
npm install @pilates/render
```

`@pilates/core` is a peer of this package's runtime dep — installing
`@pilates/render` pulls it in automatically.

## Quick start

```ts
import { render } from '@pilates/render';

const out = render({
  width: 80,
  height: 5,
  flexDirection: 'row',
  children: [
    { flex: 1, border: 'rounded', title: 'Logs', children: [{ text: 'user logged in' }] },
    { width: 20, border: 'single', title: 'Status', children: [{ text: 'ok', color: 'green', bold: true }] },
  ],
});

process.stdout.write(out);
// ╭─ Logs ───────────────────────────────────────────────────╮┌─ Status ─────────┐
// │user logged in                                            ││ok                │
// │                                                          ││                  │
// ╰──────────────────────────────────────────────────────────╯└──────────────────┘
```

## Tree shape

A `RenderNode` is either a **container** (with optional `children`) or a
**text leaf** (with a `text` property). Both share the layout properties
from `@pilates/core`, expressed as plain object fields.

```ts
import type { RenderNode } from '@pilates/render';

const tree: RenderNode = {
  width: 40, height: 10,
  flexDirection: 'column',
  padding: 1,
  children: [
    { height: 1, children: [{ text: 'header', bold: true }] },
    { flex: 1, border: 'single', children: [{ text: 'body content' }] },
  ],
};
```

## Style options

| Category | Properties |
|---|---|
| Layout | All of `@pilates/core`'s setters as POJO fields: `flexDirection`, `flex`, `width`, `height`, `padding`, `margin`, `gap`, `justifyContent`, `alignItems`, `alignSelf`, `alignContent`, `flexWrap`, `positionType`, `position`, `display`, etc. |
| Border | `border` (5 styles), `borderColor`, `title`, `titleColor` |
| Text | `color`, `bgColor`, `bold`, `italic`, `underline`, `dim`, `inverse`, `wrap` (`'wrap'` / `'truncate'` / `'none'`) |

## Border styles

Set `border: '<style>'` on any container:

```
single   ┌─────┐    rounded  ╭─────╮    double  ╔═════╗    bold  ┏━━━━━┓
         │     │             │     │            ║     ║          ┃     ┃
         └─────┘             ╰─────╯            ╚═════╝          ┗━━━━━┛
```

`'none'` (the default) draws nothing. `title` is rendered inline at the top
edge with surrounding `─` padding (`┌─ Title ───┐`); titles longer than
the available run are truncated with `…`.

## Colors

Three formats, accepted everywhere a color is expected (`color`,
`bgColor`, `borderColor`, `titleColor`):

```ts
{ text: 'red',     color: 'red'      }   // 16 named colors
{ text: 'orange',  color: '#ff5500'  }   // 24-bit hex
{ text: 'palette', color: 208       }   // 256-color index
```

Named: `black`, `red`, `green`, `yellow`, `blue`, `magenta`, `cyan`,
`white`, `gray`, plus the eight `bright*` variants.

## API

```ts
import { render, renderToFrame, Frame } from '@pilates/render';

render(tree: RenderNode, options?: { ansi?: boolean }): string
renderToFrame(tree: RenderNode): Frame
```

- **`render(tree, { ansi })`** — paints the tree and returns a printable
  string. ANSI is auto-stripped when stdout is not a TTY (e.g. piped
  output); set `ansi: true` or `false` to override.
- **`renderToFrame(tree)`** — returns the underlying `Frame` (2D cell
  grid). Use this to drive diff-based redraws via [`@pilates/diff`](../diff),
  to inspect cells in tests, or to write your own ANSI emitter.

### Low-level SGR helpers (added in `1.0.0-rc.2`)

For consumers building alternative renderers that need to match this
package's output byte-for-byte:

```ts
import {
  Cell, CellStyle, Rect, Attr,
  SGR_RESET, attrsSgr, bgSgr, fgSgr, packAttrs, sgr,
} from '@pilates/render';
```

- `Cell` / `CellStyle` / `Rect` — the cell-grid value types
- `Attr` — bitmask enum (`Bold`, `Dim`, `Italic`, `Underline`, `Inverse`)
- `fgSgr(color)` / `bgSgr(color)` — SGR parameter for fg/bg color
- `attrsSgr(bitmask)` — SGR parameters for an attribute bitmask
- `sgr(params)` — wrap a parameter list in `\x1b[...m`
- `SGR_RESET` — `\x1b[0m`
- `packAttrs(style)` — pack a `TextStyle` bag into a numeric bitmask

`@pilates/diff` uses exactly these helpers, so its output matches what
`render()` would emit for the same cells.

## TTY handling

By default, `render()` checks `process.stdout.isTTY`:

| Context | ANSI emitted? |
|---|---|
| Interactive terminal (TTY) | Yes |
| Piped/redirected output | No (escapes stripped) |
| Non-Node runtimes | Yes |

Override explicitly when you need to force one or the other (snapshot
tests, capturing output for a log file, etc.):

```ts
render(tree, { ansi: true })   // force ANSI on
render(tree, { ansi: false })  // strip ANSI even in a TTY
```

## Status

Release candidate (`1.0.0-rc.2`). API is stable for `render`,
`renderToFrame`, and the low-level SGR helpers.

## License

MIT
