<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/pilatesjs/pilates/main/assets/logo-dark.svg">
  <img src="https://raw.githubusercontent.com/pilatesjs/pilates/main/assets/logo.svg" alt="pilates" width="48">
</picture>

# @pilates/diff

> Cell-level frame diffing + minimal ANSI redraw sequences for live Pilates
> TUIs. Pairs with [`@pilates/render`](../render).

When a TUI re-renders frequently, you don't want to repaint the whole screen
every frame — that's flicker, wasted CPU, and a lot of bytes flying down
stdout. `@pilates/diff` solves that:

```ts
import { renderToFrame } from '@pilates/render';
import { diff, applyDiff } from '@pilates/diff';

let prev = null;

function tick() {
  const next = renderToFrame(buildTree());
  process.stdout.write(applyDiff(diff(prev, next)));
  prev = next;
}
```

`diff()` walks two `Frame`s cell-by-cell and emits only the cells whose char,
foreground, background, or attributes changed. `applyDiff()` turns those
changes into a single string of ANSI cursor-positioning + SGR + character
output, ready to write to stdout.

## API

### `diff(prev: Frame | null, next: Frame): CellChange[]`

Computes the minimal cell-changes between two frames. If `prev` is `null`
(or omitted), every visible cell of `next` is returned (a full first paint).
If `prev` and `next` have different dimensions, all cells of `next` are
returned and a fresh-canvas redraw is implied.

### `applyDiff(changes: CellChange[]): string`

Encodes a list of cell-changes as one ANSI string. Each change becomes a
cursor move (`CSI <row>;<col> H`) + SGR style + the character. The output
restores the default style at the end (`SGR 0`).

### `CellChange`

```ts
interface CellChange {
  x: number;          // 0-indexed column
  y: number;          // 0-indexed row
  char: string;       // the grapheme cluster to paint
  width: 1 | 2;       // narrow or wide
  fg: Color | undefined;
  bg: Color | undefined;
  attrs: number;      // bitmask of bold/italic/underline/dim/inverse
}
```

## What this enables

- **Live dashboards.** Re-render every second; only changed cells go down
  the wire.
- **Animation.** Tween a value, render each frame, diff against the
  previous, push the delta.
- **Scroll-back-friendly TUIs.** Avoid screen-clear on each repaint — the
  scrollback stays clean.

## Status

`0.1.0` — feature-complete for the documented API. The diff is
deliberately simple (per-cell, no run-length grouping). A future version
may add adjacent-cell coalescing for fewer cursor moves on dense changes.

The package stays in the `0.x` line for now — newer than `core` /
`render`, and the cursor-coalescing work above is a likely
non-additive change worth saving for `0.2.0`. Tracked in
[issue #11](https://github.com/pilatesjs/pilates/issues/11) (bumps to
`0.2.0` alongside the `core` / `render` `1.0.0` promotion at bake-end).
