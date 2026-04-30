# Pilates

> Flex layout engine + React reconciler for terminal UIs.

This `pilates` package on npm is the brand-name placeholder. The actual code
is published under the **`@pilates`** scope:

| Package | Description |
|---|---|
| [`@pilates/core`](https://www.npmjs.com/package/@pilates/core)     | The engine — imperative `Node` API, integer cell coordinates, pure TypeScript. |
| [`@pilates/render`](https://www.npmjs.com/package/@pilates/render) | The renderer — declarative tree → painted ANSI string with borders, colors, text wrap. |
| [`@pilates/diff`](https://www.npmjs.com/package/@pilates/diff)     | Cell-level frame diff + minimal ANSI redraw. |
| [`@pilates/react`](https://www.npmjs.com/package/@pilates/react)   | React reconciler — author terminal UIs with JSX and hooks. |

## Install

```bash
# Most users want one of these:
npm install @pilates/render             # declarative POJO tree → painted string
npm install @pilates/react@next react   # JSX + hooks (pre-release)

# Or compose your own pipeline:
npm install @pilates/core @pilates/render @pilates/diff
```

## Project home

https://github.com/pilatesjs/pilates

## License

MIT
