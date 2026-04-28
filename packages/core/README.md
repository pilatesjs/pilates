# @tercli/core

> Headless flex layout engine for terminal UIs. Imperative `Node` API, integer cell
> coordinates, terminal-correct text measurement. **Pure TypeScript, zero runtime
> dependencies.**

`@tercli/core` is what you get when you take Yoga's flex algorithm, rebuild it for
the terminal (integer cells, CJK / emoji / wide-char awareness, ANSI escape
passthrough), and *unbundle* it from any UI framework. Use it directly, or wrap it
in React, Vue, Svelte, or anything else.

## Install

```bash
npm install @tercli/core
```

## Quick start

```ts
import { Node, Edge } from '@tercli/core';

const root = Node.create();
root.setFlexDirection('row');
root.setWidth(80);
root.setHeight(24);
root.setPadding(Edge.All, 1);

const main = Node.create();
main.setFlex(1);
const sidebar = Node.create();
sidebar.setWidth(20);

root.insertChild(main, 0);
root.insertChild(sidebar, 1);

root.calculateLayout();

main.getComputedLayout();    // { left:1, top:1, width:57, height:22 }
sidebar.getComputedLayout(); // { left:58, top:1, width:20, height:22 }
```

## Style API

Setters mirror Yoga / CSS Flexbox semantics. All values are in terminal cells.

| Category | Setters |
|---|---|
| Direction | `setFlexDirection`, `setFlexWrap` |
| Sizing | `setWidth`, `setHeight`, `setMinWidth`, `setMinHeight`, `setMaxWidth`, `setMaxHeight` |
| Flex | `setFlex` (shorthand), `setFlexGrow`, `setFlexShrink`, `setFlexBasis` |
| Spacing | `setPadding(edge, n)`, `setMargin(edge, n)`, `setGap('row' \| 'column', n)` |
| Alignment | `setJustifyContent`, `setAlignItems`, `setAlignSelf`, `setAlignContent` |
| Position | `setPositionType('relative' \| 'absolute')`, `setPosition(edge, n)` |
| Visibility | `setDisplay('flex' \| 'none')` |

`Edge` is `Top` / `Right` / `Bottom` / `Left` / `Horizontal` / `Vertical` / `All`.

## Text measurement

```ts
import { stringWidth, cellWidth, graphemes, stripAnsi } from '@tercli/core';

stringWidth('hello');      // 5
stringWidth('你好');        // 4 (each CJK char is 2 cells)
stringWidth('🔥');         // 2
stringWidth('👨‍👩‍👧');     // 2 (ZWJ family is one grapheme)
stringWidth('🇯🇵');        // 2 (regional indicator pair = flag)
stringWidth('\x1b[31mred\x1b[0m'); // 3 (ANSI stripped)
```

Driven by the latest Unicode UCD data: East Asian Width, Emoji Presentation,
Grapheme Break Property, Default Ignorable. No runtime fetch — tables are
generated at build time and shipped with the package.

## Custom text measurement (measure functions)

```ts
import { Node, MeasureMode } from '@tercli/core';

const text = Node.create();
text.setMeasureFunc((width, widthMode, height, heightMode) => {
  // Compute the natural width / height of the leaf's content.
  return { width: stringWidth('Hello'), height: 1 };
});
```

## Status

Release candidate (`1.0.0-rc.1`). The full v1 surface is implemented and
verified cell-for-cell against `yoga-layout` (Meta's reference WASM build).

**Out of v1:** `aspectRatio`, RTL/LTR direction inheritance, baseline alignment.

## License

MIT
