# `@pilates/react` — design

**Date:** 2026-04-29
**Status:** Approved (brainstorming complete; pending plan)
**Phase:** B (per `~/.claude/plans/fluffy-sauteeing-whisper.md`)
**Target initial release:** `@pilates/react@0.1.0-rc.1`, published with `next` dist-tag

## Goal

Build a React reconciler for Pilates so users can author terminal UIs with JSX and hooks, with the same engine guarantees (cell-correct layout, incremental redraw via `@pilates/diff`) as the imperative `@pilates/render` API.

This is the differentiator that makes Pilates an addressable alternative for the Ink user base.

## Strategic decisions (locked)

| Decision | Choice | Rationale |
|---|---|---|
| Repo placement | Same monorepo (`packages/react/`) | Coordinated engine bumps, single CI, single issue tracker |
| Component names | Match Ink: `Box`, `Text`, `Spacer`, `Newline` | Migration ergonomics; differentiation lives in internals |
| Input hooks | Omit `useInput` / `useFocus` entirely | Input handling lands in v2; clean export shape today |
| Concurrent mode | Defer | Adds reconciler complexity; terminal use case unclear |
| React version | React 19+ only (peer) | Cleaner code; matches "newest stack" framing |
| Commit strategy | Synchronous on commit | Simplest; matches Ink behavior |
| Terminal lifecycle | Minimal: write to scrollback, no alt screen | Matches existing `examples/dashboard` posture |
| Root sizing | Auto from `process.stdout.{columns,rows}` + SIGWINCH | Most ergonomic; explicit override available |
| `<Text>` children | Strict: only string / number / `<Text>` / `<Newline>` | Maps cleanly to the existing `TextNode` shape |
| Reconciler core | Approach A: mutate `RenderNode` POJO trees directly | Zero new types; reuses `@pilates/render`'s `build.ts` |

## Architecture

### Package layout

```
packages/react/
├── package.json              peer: react@^19, react-reconciler@^0.31
│                             deps: @pilates/{core,render,diff} (workspace:*)
├── tsconfig.json             extends base; jsx: "react-jsx"; references core/render/diff
├── README.md
└── src/
    ├── index.ts              public barrel: render, Box, Text, Spacer, Newline,
    │                         useApp, useStdout, useStderr, type re-exports
    ├── components.tsx        JSX → host-tag mapping (real React FCs)
    ├── host-config.ts        HostConfig implementation (~150 lines)
    ├── reconciler.ts         createReconciler() factory; root container type
    ├── render.tsx            public render() entry: SIGWINCH wiring,
    │                         diff loop, stdout write, unmount cleanup
    ├── hooks.ts              useApp, useStdout, useStderr; AppContext
    ├── test-utils.ts         (test-only, NOT in public exports)
    └── render.test.tsx       integration tests
```

### Build & module discipline

- ESM-only, `engines.node >=20`, `sideEffects: false`
- `tsc -b` composite project refs to `core`, `render`, `diff`
- `verbatimModuleSyntax`, strict TS, `noUncheckedIndexedAccess` (matches base)
- Output to `dist/`; `package.json` `exports` field points to `./dist/index.js`
- `react-jsx` runtime — no custom JSX factory; components are real FCs that emit `React.createElement('pilates-box', props, children)` so devtools shows `<Box>` not `<pilates-box>`

### Type mapping to existing engine

- `<Box props>` → `ContainerNode` (full passthrough of `LayoutProps & BorderProps`)
- `<Text props>` → `TextNode` (children flattened into `text`; `TextStyle` props passthrough)
- `<Spacer>` → `<Box flexGrow={1} />` shorthand
- `<Newline>` → injects `\n` at flatten time

No new node types are introduced. The React tree IS a `RenderNode` tree.

## Public API surface

### Components

```tsx
<Box flexDirection="column" padding={1} border="single" title="…">…</Box>
<Text color="green" bold wrap="truncate">…</Text>
<Spacer />
<Newline />
```

- `<Box>` props: full `LayoutProps & BorderProps` from `@pilates/render` + `children?: ReactNode`
- `<Text>` props: `TextStyle` + `wrap?: 'wrap' | 'truncate' | 'none'` + `children: ReactNode`
- `<Spacer>` props: none
- `<Newline>` props: none (no `count` prop in v0.1; `\n\n` literal works)

### Hooks (read-only, contextual)

```tsx
const { exit }                                 = useApp();
const { stdout, write, columns, rows }         = useStdout();
const { stderr, write }                        = useStderr();
```

- `useApp().exit(error?: Error)` — unmounts; resolves (or rejects) `render()`'s `waitUntilExit` promise
- `useStdout()` and `useStderr()` — stream + passthrough write + current `columns`/`rows`
  - dimensions update via SIGWINCH through React context; consumers re-render on resize

### Entry point

```ts
function render(
  element: ReactElement,
  options?: { width?: number; height?: number; stdout?: NodeJS.WriteStream; stderr?: NodeJS.WriteStream }
): { unmount: () => void; waitUntilExit: () => Promise<void> };
```

### Type re-exports from `@pilates/render`

`Color`, `NamedColor`, `BorderStyle`, `FlexDirection`, `FlexWrap`, `Justify`, `Align`, `PositionType`, `EdgeValue`, `Wrap`. One import covers everything.

### Deferred to later versions

- `useInput`, `useFocus`, `useFocusManager` — v2 (input handling)
- `Static` (append-only region) — v0.2 if requested
- `Transform` (text post-processor) — v0.2 if requested
- Nested-`<Text>` style inheritance — known limitation, v2
- `count` prop on `<Newline>` — YAGNI
- `dimColor` shorthand — covered by `dim={true}`

## Data flow

### `render()` lifecycle

```
render(<App/>) called
  ├─ resolve initial size: options.{width,height} ?? stdout.{columns,rows} ?? 80x24
  ├─ create root RenderNode (ContainerNode with resolved dimensions)
  ├─ create reconciler container, attach root
  ├─ if stdout.isTTY: subscribe to SIGWINCH via `process.stdout.on('resize', …)`
  ├─ react-reconciler.createContainer + updateContainer(<App/>)
  │     └─ HostConfig methods fire as React mounts:
  │          createInstance('pilates-box', props)   → new ContainerNode { children: [] }
  │          createInstance('pilates-text', props)  → new TextNode { text: '' }
  │          createTextInstance(text)               → string fragment
  │          appendChild / insertBefore / removeChild → splice parent.children[]
  │          finalizeInitialChildren(node)          → flatten string children to TextNode.text
  ├─ resetAfterCommit(root) fires once per commit
  │     └─ flushFrame(root):
  │           1. const next  = renderToFrame(root)         // @pilates/render
  │           2. const diffs = diff(prev, next)            // @pilates/diff
  │           3. const ansi  = applyDiff(diffs)            // @pilates/diff
  │           4. stdout.write(ansi)
  │           5. prev = next
  └─ returns { unmount, waitUntilExit }
```

### `setState` / re-render

- `commitUpdate(node, oldProps, newProps)` shallow-merges new props onto the `RenderNode`
- `commitTextUpdate(node, _, newText)` rewrites `node.text`
- `appendChild` / `removeChild` / `insertBefore` mutate `parent.children[]` directly
- `resetAfterCommit` fires once → single `flushFrame()` call
- `flushFrame()` does `renderToFrame → diff → applyDiff → write`. Only changed cells are emitted as ANSI. **This is the headline incremental-redraw differentiator.**

### SIGWINCH (terminal resize)

- Update root node's `width`/`height` to new `stdout.columns`/`rows`
- Bump a React context value carrying `{columns, rows}` → `useStdout()` consumers re-render
- Trigger a `flushFrame()` after React's re-render
- `prev` frame's dimensions no longer match → `diff()` falls into the full-repaint path (existing behavior of `diff.ts`). No special-casing needed.

### `unmount()` / `exit()`

- `react-reconciler.updateContainer(null, root)` — runs unmount lifecycles
- Detach SIGWINCH listener
- Write SGR reset + final newline so cursor lands on a fresh scrollback line
- Resolve `waitUntilExit` (or reject if `exit(error)` was called)
- Idempotent — second call is a no-op via a flag

### Initial paint

- `prev` is `null` on the first commit → `diff()` returns every visible cell → `applyDiff` emits a full-frame ANSI string. Same code path as resize. Single source of truth.

### Non-TTY behavior

- If `stdout.isTTY` is falsy: skip SIGWINCH subscription; still run the diff loop
- Output is the raw ANSI escape stream — same as Ink. Users who don't want this should not call `render()` when not on a TTY.
- No special pipe handling in v0.1.

### Specific design points

- **`prev` lives in `render()`'s closure**, not on the root node. Engine stays pure (RenderNode trees are values, not stateful objects); concurrent renders to different stdouts are correctly isolated.
- **No double-buffering, no async commit.** `resetAfterCommit` fires synchronously; we write to stdout in the same tick.
- **No backpressure handling.** `stdout.write`'s return value is ignored. Data rates (a few KB per redraw) make this academic.

## Error handling

### Three classes of errors, three responses

**1. Render errors thrown inside React components**

- React's commit phase throws into HostConfig methods; we let it propagate to react-reconciler's built-in error handling
- Error Boundaries catch them; otherwise bubble to `onUncaughtError` HostConfig hook
- Our root `onUncaughtError` writes a clean error frame to stderr (red "Pilates render error:" + message + short stack), then rejects `waitUntilExit`
- **No automatic recovery / re-render.** A render error means the app exits. Same posture as Ink. Users wanting recovery wrap in their own Error Boundary.

**2. Validation errors at the engine boundary**

- **Non-string/non-Text/non-Newline child of `<Text>`** → throws at commit-time:
  `"Pilates: <Text> children must be string, number, <Text>, or <Newline>. Got: <Component>"` (with the offending component's display name)
- **Layout error from `@pilates/core`** (e.g. invalid measure return) → re-thrown as-is; the engine's existing messages are already specific
- Both flow through `onUncaughtError`; no special-casing.

**3. Stream errors (stdout/stderr write fails)**

- `process.stdout` can emit `'error'` (closed pipe, EPIPE on broken pipe to head/less)
- We attach a listener once at `render()` start; sets a flag and triggers `unmount()`
- We do NOT swallow — `unmount()` resolves `waitUntilExit` with the stream's error so the calling process exits non-zero
- EPIPE is the only real-world case (CLI tools piping to `less`/`head`)

### Operational details

- **No try/catch around `stdout.write`.** Node surfaces stream failures via `'error'` events, not write() throws.
- **No retry logic.** A failed paint means the terminal is in an unknown state; surfacing the error beats writing more.
- **Cleanup is idempotent.** `unmount()` callable twice (e.g. SIGINT handler + automatic exit).
- **No SIGINT/SIGTERM handler in v0.1.** If users want Ctrl-C to unmount cleanly, they wire `process.on('SIGINT', () => app.unmount())` themselves. Documented in README.

### Out of scope for error handling

- React Suspense errors (concurrent deferred)
- Component lifecycle errors during unmount (react-reconciler logs to console.error already)
- Process-level OOM / crashes

## Testing

### Test runner

Vitest (matches existing packages). New file: `packages/react/src/render.test.tsx`. Vitest 2.x handles TSX transparently.

### Idiom: render to string, assert on the string

```tsx
import { renderToString } from './test-utils.js';

const out = renderToString(
  <Box border="single" padding={1}>
    <Text color="green" bold>hello</Text>
  </Box>,
  { width: 20, height: 5 }
);
expect(out).toMatchInlineSnapshot(`…`);
```

`renderToString` (~20 lines) creates a reconciler with a write-buffer fake instead of `process.stdout`, mounts the element, captures all writes, returns the concatenated string. Lives in `packages/react/src/test-utils.ts` — **NOT** exported from the public `index.ts`.

### Test categories (~23 tests total)

1. **Static tree → expected output** (~8 cases): JSX tree renders cell-for-cell identical to the imperative `render()` API on the equivalent `RenderNode`. Proves the JSX → RenderNode mapping is faithful.
2. **Re-render emits the right diff** (~5 cases): mount, snapshot buffer; `setState` (via wrapper exposing setter through ref); snapshot again. Assert delta contains only changed cells, not full repaint. **The headline differentiator's test.**
3. **Conditional rendering** (~3 cases): `{cond && <Box>…</Box>}` mounts/unmounts; unmounted region clears (renders as spaces).
4. **Component composition** (~4 cases): fragments, arrays with keys, custom components composing primitives.
5. **Hooks** (~3 cases): `useApp().exit()` resolves render promise; `useStdout()` reflects current dimensions; SIGWINCH simulation updates context. SIGWINCH faked via stub stdout's `'resize'` event.

Total project test count after Phase B: **229 + 23 = ~252**, all green.

### Smoke tests for examples

- Each of `react-counter`, `react-dashboard`, `react-modal` exports a default `App` component (so they're testable as well as runnable via `tsx`)
- A test imports each example's `App`, renders it once at a known size, asserts non-empty output and no thrown errors
- Catches "example bitrots silently" failures

### Out of testing scope (v0.1)

- Real terminal behavior (alt screen, real OS SIGWINCH)
- Concurrent mode (deferred)
- StrictMode double-renders (testing React itself)
- Performance regression (covered by `pnpm bench` for engine; reconciler overhead is bounded and outside our control)

## Verification before publish

```bash
cd /e/Github/tercli
pnpm --filter @pilates/react run build              # builds clean
pnpm --filter @pilates/react run typecheck          # strict TS clean
pnpm test                                            # ~252 tests green
pnpm --filter @pilates-examples/react-counter dev    # smoke run
pnpm --filter @pilates-examples/react-dashboard dev  # smoke run
pnpm --filter @pilates-examples/react-modal dev      # smoke run
pnpm --filter @pilates/react publish --dry-run --access=public --no-git-checks
                                                     # confirm dist contents, no source leakage
```

## Publish

- Tag: `@pilates/react@0.1.0-rc.1` (per-package tag convention)
- Publish: `cd packages/react && pwd && pnpm publish --access=public --no-git-checks --tag next`
- The `--tag next` is critical: users running `npm install @pilates/react` should get an explicit pre-release signal, not the rc by default

## Open questions for plan-writing phase

None blocking. Implementation-level details (exact HostConfig method signatures for react-reconciler 0.31, the precise shape of `flushFrame`'s scheduling, etc.) belong in the plan, not this design.
