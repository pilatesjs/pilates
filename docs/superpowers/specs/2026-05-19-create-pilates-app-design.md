# `create-pilates-app` — project scaffolder

## Problem

A first-time CLI/TUI author who wants to try Pilates has no on-ramp.
They must hand-assemble a `package.json` (which deps? which
versions?), a `tsconfig.json` (which `jsx` / `module` settings?), an
entry file, and a runner — every one of which is a place to get stuck
before writing a line of UI. Pilates is positioned for greenfield
first-time authors; that audience is exactly the one a missing
scaffolder turns away.

`create-pilates-app` is the on-ramp: `npm create pilates-app my-app`
generates a runnable starter `@pilates/react` project.

## Approach

A new published package `create-pilates-app`. `npm create pilates-app`
resolves to it and runs its `bin`. Template files are shipped as
**literal files** in the package (a `template/` directory the CLI
copies) — not string literals in code, not a runtime fetch — so the
template stays a real, lintable, inspectable project and the
scaffolder's test can copy real files into a temp dir and assert.

The scaffolder generates files and **prints next steps** (`cd`,
install, `npm run dev`); it does not run `npm install` itself —
package-manager-agnostic, fast, and with no install-failure surface.

One template only — a minimal interactive starter. A young ecosystem
is better served by one excellent starting point than a menu of
half-built ones, and a single template means the CLI needs no
template prompt.

## Package layout

`packages/create-pilates-app/` — a published package, picked up by the
`pnpm-workspace.yaml` `packages/*` glob. Its `template/` subdirectory
is plain files, not a nested workspace member (the glob is one level
deep). **Zero runtime dependencies.**

```
packages/create-pilates-app/
  package.json        name `create-pilates-app`, type module,
                      bin → dist/index.js, files: [dist, template]
  tsconfig.json       mirrors the other packages' build config
  tsconfig.typecheck.json
  src/
    create-app.ts     the pure, testable scaffold core
    create-app.test.ts
    index.ts          the CLI entry (argv / prompt / print)
  template/           the files the CLI copies (see below)
```

Builds to `dist/` with `tsc`, like every other package. `src/index.ts`
starts with a `#!/usr/bin/env node` shebang (TypeScript ≥5 preserves
it in the emitted JS).

## The CLI — `src/index.ts`

`npm create pilates-app [dir]`. `main()`:

1. Read the target directory from the first positional CLI argument
   (`process.argv.slice(2)[0]`). `npm create pilates-app my-app`
   forwards `my-app`.
2. If no directory argument, prompt for one via
   `node:readline/promises` (default `pilates-app`) — no prompt
   library; one question does not warrant a dependency.
3. Call `createApp({ targetDir, projectName })`.
4. On success, print next steps: `cd <dir>`, `npm install`,
   `npm run dev`.

`--help` / `-h` prints a one-line usage string and exits. No other
flags (YAGNI).

Errors from `createApp` (e.g. a non-empty target directory) are
caught, printed as a clear message, and the process exits non-zero.

## The scaffold core — `src/create-app.ts`

`createApp({ targetDir, projectName }: { targetDir: string;
projectName: string }): void` — the pure, unit-testable core, with no
`argv` or prompt concerns:

1. Resolve `targetDir` to an absolute path. If it exists and is a
   non-empty directory, throw a clear `Error`. Creating it fresh is
   fine.
2. Recursively copy `template/` (resolved relative to the package, so
   it works from `dist/` after build) into `targetDir`.
3. **Rename** any file whose name begins with `_` by replacing that
   leading `_` with a `.` — so the template's `_gitignore` lands as
   `.gitignore`.
   (npm drops or renames a literal `.gitignore` when packing a
   published package; underscore-prefixing the template dotfile and
   un-prefixing on copy is the standard create-* workaround.)
4. **Substitute** the literal token `__PROJECT_NAME__` with
   `projectName` in the copied `package.json` and `README.md`.

`projectName` is the basename of `targetDir`.

## The template — `packages/create-pilates-app/template/`

- **`_gitignore`** → copied as `.gitignore`. Contents: `node_modules`.
- **`package.json`** — `"name": "__PROJECT_NAME__"`, `"private": true`,
  `"type": "module"`, `"scripts": { "dev": "tsx index.tsx" }`;
  dependencies `@pilates/react` (`^0.3.0` — the current **published**
  version; the minimal API the starter uses — `Box` / `Text` /
  `render` / `useApp` / `useInput` — is all present in 0.3.0) and
  `react` (`^19.0.0`); devDependencies `@types/react`, `tsx`,
  `typescript`.
- **`tsconfig.json`** — minimal, mirroring
  `examples/react-counter/tsconfig.json` (`jsx: react-jsx`, ESM
  module resolution, `strict`).
- **`index.tsx`** — the ~40-line minimal interactive app: a
  `<Box border="single">` showing a counter, `useInput` handling
  `+` / `-` to change it and `q` to quit, `useState` for the count,
  `useApp().exit`, and `render(<App />)` + `await
  instance.waitUntilExit()`. Deliberately the same shape as the
  existing, CI-typechecked `examples/react-counter` so the template
  cannot rot silently.
- **`README.md`** — short: `# __PROJECT_NAME__`, `npm install`,
  `npm run dev`, a link to the Pilates docs/repo.

The template's `index.tsx` `useInput` handler receives a `KeyEvent`
(its `.ch` field is the printable character) — not a bare string.

The template depends on the **published** `@pilates/react`, so
`template/` is correctly NOT a workspace member — the monorepo never
resolves or installs its dependencies, and a `pnpm install` at the
repo root ignores it.

## Testing — `src/create-app.test.ts`

Vitest, exercising `createApp` into a fresh temp directory
(`node:os` `tmpdir` + a unique subdir; removed after each test):

- A scaffold into a new directory produces every expected file
  (`package.json`, `tsconfig.json`, `index.tsx`, `README.md`,
  `.gitignore`).
- `_gitignore` is delivered as `.gitignore`, and no `_gitignore`
  remains.
- The generated `package.json` is valid JSON, its `name` equals the
  passed `projectName`, and it contains no leftover `__PROJECT_NAME__`
  token.
- `README.md` has its `__PROJECT_NAME__` substituted.
- The generated `index.tsx` imports the expected `@pilates/react`
  symbols (`Box`, `Text`, `render`, `useApp`, `useInput`).
- `createApp` throws when the target directory exists and is
  non-empty.

The unit test does not run `npm install` or execute the generated
app — no network. The template's app code mirroring the typechecked
`react-counter` example is what keeps the runnable-ness honest.

## Validation

The full workspace stays green (`pnpm test`, `pnpm typecheck`,
`pnpm lint`). `create-pilates-app` joins the build/typecheck/lint set
like any package. Ships as one branch / one PR; additive — a new
package, nothing else changes. The package is unpublished until a
deliberate release (it lands in CHANGELOG `## Unreleased`).
