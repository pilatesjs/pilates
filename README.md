# tercli

> Headless layout engine for terminal UIs. Pure TypeScript, zero runtime dependencies.

`tercli` is what you get when you take Yoga's flex algorithm, rebuild it for the
terminal (integer cell coordinates, CJK / emoji / wide-char awareness, ANSI escape
passthrough), and *unbundle* it from a UI framework. Use it directly, or wrap it in
React, Vue, Svelte, or anything else.

## Packages

| Package | What |
|---|---|
| [`@tercli/core`](./packages/core) | The engine. Imperative `Node` API, returns integer cell coordinates. |
| [`@tercli/render`](./packages/render) | Out-of-box renderer. Declarative tree → painted string with ANSI styling and box-drawing borders. |

## Status

Early development. See [the design](./docs) for the roadmap.

## License

MIT
