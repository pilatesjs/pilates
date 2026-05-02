# @pilates-e2e/smoke

In-process smoke tests for the `examples/` apps. Each test imports the
example's `App` component, mounts it via `mountWithInput` from
`@pilates/react/test-utils`, drives keystrokes / fake timers, and asserts
on the rendered output. This is integration coverage for the full stack
(`@pilates/core` + `@pilates/render` + `@pilates/diff` + `@pilates/react`
+ `@pilates/widgets`).

## Running

```sh
pnpm test:e2e
```

## Scope

Only the four React-based examples are smoke-testable here:
`react-counter`, `react-dashboard`, `react-modal`, `react-wizard`. The
remaining six examples (`chat-log`, `dashboard`, `gallery`, `modal`,
`progress-table`, `split-pane`) are static `@pilates/render` demos with
no interactive surface — they call `process.stdout.write(render(tree))`
once and exit, so there is nothing to drive in a test. They are still
exercised at build / typecheck time.

## Real-PTY layer

`wizard.pty.test.ts` (added separately) spawns the wizard through
`node-pty` to cover the surface in-process tests can't see: the
`import.meta.url === pathToFileURL(process.argv[1]).href` auto-run
guard, real `setRawMode`, CRLF handling, and the actual `node` binary
invocation.
