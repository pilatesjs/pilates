# create-pilates-app Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new `create-pilates-app` package so `npm create pilates-app my-app` scaffolds a runnable minimal `@pilates/react` starter project.

**Architecture:** A zero-runtime-dependency package `packages/create-pilates-app/`. A pure `createApp({ targetDir, projectName })` core copies bundled `template/` files (renaming `_`-prefixed dotfiles, substituting a `__PROJECT_NAME__` token); a thin `index.ts` CLI parses argv / prompts and prints next steps. The template is a ~40-line interactive counter TUI.

**Tech Stack:** TypeScript (NodeNext ESM), Node built-ins only (`node:fs`, `node:path`, `node:url`, `node:readline/promises`), Vitest.

---

## File Structure

```
packages/create-pilates-app/
  package.json              name `create-pilates-app`, bin, files:[dist,template]
  tsconfig.json             build config (extends monorepo base)
  tsconfig.typecheck.json   typecheck config (includes the test file)
  src/
    create-app.ts           the pure scaffold core — copy/rename/substitute
    create-app.test.ts      vitest, exercising createApp into a temp dir
    index.ts                the CLI entry — argv / prompt / print
  template/                 files the CLI copies into a new project
    _gitignore              -> delivered as `.gitignore`
    package.json            generated project manifest (`__PROJECT_NAME__`)
    tsconfig.json           generated project's standalone tsconfig
    index.tsx               the ~40-line starter app
    README.md               generated project's README (`__PROJECT_NAME__`)
```

Plus a `CHANGELOG.md` entry under `## Unreleased`.

Spec: `docs/superpowers/specs/2026-05-19-create-pilates-app-design.md`. Branch `create-pilates-app` (already created, spec committed). One PR.

---

### Task 1: Package skeleton + template files

This task creates configuration and template-data files only — there is no code logic, so no TDD cycle. Verification is `pnpm install` and file presence.

**Files:**
- Create: `packages/create-pilates-app/package.json`
- Create: `packages/create-pilates-app/tsconfig.json`
- Create: `packages/create-pilates-app/tsconfig.typecheck.json`
- Create: `packages/create-pilates-app/template/_gitignore`
- Create: `packages/create-pilates-app/template/package.json`
- Create: `packages/create-pilates-app/template/tsconfig.json`
- Create: `packages/create-pilates-app/template/index.tsx`
- Create: `packages/create-pilates-app/template/README.md`

- [ ] **Step 1: Create `packages/create-pilates-app/package.json`**

```json
{
  "name": "create-pilates-app",
  "version": "0.1.0",
  "description": "Scaffold a new Pilates terminal-UI app.",
  "license": "MIT",
  "author": "Zhijie Wang",
  "type": "module",
  "bin": {
    "create-pilates-app": "./dist/index.js"
  },
  "files": ["dist", "template"],
  "scripts": {
    "build": "tsc -b",
    "typecheck": "tsc -p tsconfig.typecheck.json",
    "clean": "rm -rf dist *.tsbuildinfo",
    "prepublishOnly": "tsc -b"
  },
  "repository": {
    "type": "git",
    "url": "git+https://github.com/pilatesjs/pilates.git",
    "directory": "packages/create-pilates-app"
  },
  "homepage": "https://github.com/pilatesjs/pilates#readme",
  "bugs": {
    "url": "https://github.com/pilatesjs/pilates/issues"
  },
  "keywords": ["terminal", "tui", "cli", "scaffold", "create", "pilates"],
  "engines": {
    "node": ">=20"
  }
}
```

- [ ] **Step 2: Create `packages/create-pilates-app/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "./src",
    "outDir": "./dist",
    "tsBuildInfoFile": "./.tsbuildinfo",
    "composite": true
  },
  "include": ["src/**/*"],
  "exclude": ["src/**/*.test.ts", "dist", "node_modules", "template"]
}
```

- [ ] **Step 3: Create `packages/create-pilates-app/tsconfig.typecheck.json`**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": true,
    "composite": false,
    "incremental": false
  },
  "include": ["src/**/*"],
  "exclude": ["dist", "node_modules", "template"]
}
```

- [ ] **Step 4: Create `packages/create-pilates-app/template/_gitignore`**

```
node_modules
```

- [ ] **Step 5: Create `packages/create-pilates-app/template/package.json`**

```json
{
  "name": "__PROJECT_NAME__",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx index.tsx"
  },
  "dependencies": {
    "@pilates/react": "^0.4.0",
    "react": "^19.0.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "tsx": "^4.19.2",
    "typescript": "^5.7.0"
  }
}
```

- [ ] **Step 6: Create `packages/create-pilates-app/template/tsconfig.json`**

This is the *generated project's* standalone tsconfig — it does NOT extend the monorepo base.

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "jsx": "react-jsx",
    "jsxImportSource": "react",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["index.tsx"]
}
```

- [ ] **Step 7: Create `packages/create-pilates-app/template/index.tsx`**

```tsx
import { Box, Text, render, useApp, useInput } from '@pilates/react';
import { useState } from 'react';

function App() {
  const [count, setCount] = useState(0);
  const { exit } = useApp();

  useInput((input) => {
    if (input === '+') setCount((n) => n + 1);
    if (input === '-') setCount((n) => n - 1);
    if (input === 'q') exit();
  });

  return (
    <Box border="single" padding={1} flexDirection="column" width={24}>
      <Text bold color="cyan">
        pilates app
      </Text>
      <Text>count: {count}</Text>
      <Text dim>+ / - to change</Text>
      <Text dim>q to quit</Text>
    </Box>
  );
}

const instance = render(<App />);
await instance.waitUntilExit();
```

- [ ] **Step 8: Create `packages/create-pilates-app/template/README.md`**

````markdown
# __PROJECT_NAME__

A terminal UI built with [Pilates](https://github.com/pilatesjs/pilates).

## Develop

```sh
npm install
npm run dev
```

Press `+` / `-` to change the counter, `q` to quit. Edit `index.tsx`
and re-run.

Learn more in the [Pilates docs](https://github.com/pilatesjs/pilates#readme).
````

- [ ] **Step 9: Install and verify**

Run: `pnpm install`
Expected: completes without error; the new `create-pilates-app` workspace package is registered (no dependency resolution errors — the package has zero dependencies, and `template/` is not a workspace member).

Run: `ls packages/create-pilates-app/template`
Expected: `_gitignore  index.tsx  package.json  README.md  tsconfig.json`

- [ ] **Step 10: Commit**

```bash
git add packages/create-pilates-app
git commit -m "$(cat <<'EOF'
feat(create-pilates-app): package skeleton + starter template

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `createApp` scaffold core

**Files:**
- Create: `packages/create-pilates-app/src/create-app.ts`
- Test: `packages/create-pilates-app/src/create-app.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/create-pilates-app/src/create-app.test.ts`:

```ts
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './create-app.js';

describe('createApp', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'cpa-test-'));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('scaffolds every expected file into a new directory', () => {
    const target = join(tmp, 'my-app');
    createApp({ targetDir: target, projectName: 'my-app' });
    for (const f of ['package.json', 'tsconfig.json', 'index.tsx', 'README.md', '.gitignore']) {
      expect(existsSync(join(target, f))).toBe(true);
    }
  });

  it('delivers _gitignore as .gitignore and leaves no _gitignore behind', () => {
    const target = join(tmp, 'app');
    createApp({ targetDir: target, projectName: 'app' });
    expect(existsSync(join(target, '.gitignore'))).toBe(true);
    expect(readdirSync(target)).not.toContain('_gitignore');
  });

  it('substitutes the project name into package.json', () => {
    const target = join(tmp, 'cool-tui');
    createApp({ targetDir: target, projectName: 'cool-tui' });
    const raw = readFileSync(join(target, 'package.json'), 'utf8');
    expect(JSON.parse(raw).name).toBe('cool-tui');
    expect(raw).not.toContain('__PROJECT_NAME__');
  });

  it('substitutes the project name into README.md', () => {
    const target = join(tmp, 'cool-tui');
    createApp({ targetDir: target, projectName: 'cool-tui' });
    const readme = readFileSync(join(target, 'README.md'), 'utf8');
    expect(readme).toContain('cool-tui');
    expect(readme).not.toContain('__PROJECT_NAME__');
  });

  it('generates an index.tsx importing the @pilates/react API', () => {
    const target = join(tmp, 'app');
    createApp({ targetDir: target, projectName: 'app' });
    const index = readFileSync(join(target, 'index.tsx'), 'utf8');
    expect(index).toContain("from '@pilates/react'");
    for (const sym of ['Box', 'Text', 'render', 'useApp', 'useInput']) {
      expect(index).toContain(sym);
    }
  });

  it('throws when the target directory exists and is non-empty', () => {
    const target = join(tmp, 'occupied');
    createApp({ targetDir: target, projectName: 'occupied' });
    expect(() => createApp({ targetDir: target, projectName: 'occupied' })).toThrow(/not empty/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/create-pilates-app/src/create-app.test.ts`
Expected: FAIL — cannot resolve `./create-app.js` (the module does not exist yet).

- [ ] **Step 3: Write the implementation**

Create `packages/create-pilates-app/src/create-app.ts`:

```ts
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The bundled template directory, resolved relative to this module.
 * `src/create-app.ts` (under Vitest) and `dist/create-app.js` (once
 * published) both sit one level below the package root, beside
 * `template/` — so `../template` is correct from either.
 */
const TEMPLATE_DIR = fileURLToPath(new URL('../template', import.meta.url));

/** Template files whose `__PROJECT_NAME__` token is substituted. */
const SUBSTITUTED = new Set(['package.json', 'README.md']);

export interface CreateAppOptions {
  /** Directory to create the project in (created if absent). */
  targetDir: string;
  /** Project name — written into the generated package.json / README. */
  projectName: string;
}

/**
 * Scaffold a new Pilates app into `targetDir` from the bundled
 * template. Each template file is copied; a leading `_` in the name
 * becomes a `.` (so `_gitignore` lands as `.gitignore`), and the
 * `__PROJECT_NAME__` token is substituted in `package.json` /
 * `README.md`.
 *
 * Throws if `targetDir` already exists as a non-empty directory.
 */
export function createApp({ targetDir, projectName }: CreateAppOptions): void {
  const dest = resolve(targetDir);
  if (existsSync(dest) && readdirSync(dest).length > 0) {
    throw new Error(`Target directory "${targetDir}" already exists and is not empty.`);
  }
  mkdirSync(dest, { recursive: true });

  for (const name of readdirSync(TEMPLATE_DIR)) {
    const destName = name.startsWith('_') ? `.${name.slice(1)}` : name;
    let content = readFileSync(join(TEMPLATE_DIR, name), 'utf8');
    if (SUBSTITUTED.has(destName)) {
      content = content.replaceAll('__PROJECT_NAME__', projectName);
    }
    writeFileSync(join(dest, destName), content);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/create-pilates-app/src/create-app.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/create-pilates-app/src/create-app.ts packages/create-pilates-app/src/create-app.test.ts
git commit -m "$(cat <<'EOF'
feat(create-pilates-app): createApp scaffold core

Copies the bundled template, renaming `_`-prefixed dotfiles and
substituting the `__PROJECT_NAME__` token.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: The CLI entry

The CLI is thin glue over `createApp` (argv parsing, an interactive prompt, printing). Its logic is not unit-tested — prompts are not cleanly mockable and the scaffold logic is already covered by Task 2 — so this task verifies the CLI by building it and running it once.

**Files:**
- Create: `packages/create-pilates-app/src/index.ts`

- [ ] **Step 1: Write the implementation**

Create `packages/create-pilates-app/src/index.ts`:

```ts
#!/usr/bin/env node
import { basename, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { createApp } from './create-app.js';

const USAGE = 'Usage: npm create pilates-app [directory]';

async function promptForDir(): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question('Project directory: (pilates-app) ')).trim();
    return answer.length > 0 ? answer : 'pilates-app';
  } finally {
    rl.close();
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(USAGE);
    return;
  }

  const positional = args.find((a) => !a.startsWith('-'));
  const targetDir = positional ?? (await promptForDir());
  const projectName = basename(resolve(targetDir));

  createApp({ targetDir, projectName });

  console.log(`\nScaffolded ${projectName} in ${targetDir}\n`);
  console.log('Next steps:');
  console.log(`  cd ${targetDir}`);
  console.log('  npm install');
  console.log('  npm run dev\n');
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
```

- [ ] **Step 2: Build the package**

Run: `pnpm --filter create-pilates-app build`
Expected: completes; `packages/create-pilates-app/dist/index.js` and `dist/create-app.js` exist. The shebang `#!/usr/bin/env node` is preserved at the top of `dist/index.js` (TypeScript ≥5 keeps it).

- [ ] **Step 3: Smoke-test the built CLI**

Run (from the repo root):
```bash
node packages/create-pilates-app/dist/index.js .cpa-smoke && ls .cpa-smoke && cat .cpa-smoke/package.json
```
Expected: prints "Scaffolded .cpa-smoke ..." and the next-steps block; `ls` shows `index.tsx package.json README.md tsconfig.json .gitignore` (use `ls -a` to see `.gitignore`); the `package.json` `name` is `.cpa-smoke`'s basename `.cpa-smoke`.

Then verify the non-empty-dir guard:
```bash
node packages/create-pilates-app/dist/index.js .cpa-smoke; echo "exit=$?"
```
Expected: prints the "already exists and is not empty" error and `exit=1`.

Clean up:
```bash
rm -rf .cpa-smoke
```

- [ ] **Step 4: Commit**

```bash
git add packages/create-pilates-app/src/index.ts
git commit -m "$(cat <<'EOF'
feat(create-pilates-app): CLI entry

Parses the target dir from argv (prompts when absent), runs createApp,
and prints next steps.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: CHANGELOG + workspace verification

**Files:**
- Modify: `CHANGELOG.md` (the `## Unreleased` section)

- [ ] **Step 1: Add the CHANGELOG entry**

In `CHANGELOG.md`, under the `## Unreleased` heading, after the existing `### Added — \`@pilates/react\`` block (the layout-devtools entry), add a new block:

```markdown
### Added — `create-pilates-app`

- New scaffolder package: `npm create pilates-app my-app` generates a
  runnable minimal `@pilates/react` starter project (an interactive
  counter TUI) — the on-ramp for first-time CLI/TUI authors.
```

- [ ] **Step 2: Verify lint**

Run: `pnpm lint`
Expected: PASS — no errors. If Biome reports a formatting diff in any `packages/create-pilates-app` file (including `template/index.tsx` / `template/*.json`), run `npx biome check --write packages/create-pilates-app` and re-run `pnpm lint`.

- [ ] **Step 3: Verify typecheck**

Run: `pnpm typecheck`
Expected: PASS — every package reports `Done`, including `create-pilates-app`.

- [ ] **Step 4: Verify tests**

Run: `npx vitest run packages/create-pilates-app`
Expected: PASS — the 6 `create-app` tests.

- [ ] **Step 5: Commit**

```bash
git add CHANGELOG.md
git commit -m "$(cat <<'EOF'
docs: changelog entry for create-pilates-app

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**Spec coverage:**
- New package `packages/create-pilates-app/`, zero runtime deps, picked up by `packages/*` glob — Task 1. ✓
- Package layout (`package.json` bin + `files:[dist,template]`, `tsconfig.json`, `tsconfig.typecheck.json`, `src/`, `template/`) — Tasks 1–3. ✓
- CLI: argv first positional → target dir, prompt via `node:readline/promises` when absent, `--help`, call `createApp`, print next steps, catch errors → non-zero exit — Task 3. ✓
- `createApp({ targetDir, projectName })`: resolve, reject non-empty dir, copy `template/`, rename leading `_`→`.`, substitute `__PROJECT_NAME__` in `package.json`/`README.md` — Task 2. ✓
- Template files (`_gitignore`, `package.json` with pinned `@pilates/react ^0.4.0`, `tsconfig.json`, `index.tsx` minimal interactive app, `README.md`) — Task 1. ✓
- `TEMPLATE_DIR` resolves correctly from `src/` (Vitest) and `dist/` (published) — `../template` from either — Task 2 (documented in code). ✓
- Tests: all expected files, `_gitignore`→`.gitignore`, name substitution in both files, `index.tsx` API imports, non-empty-dir rejection — Task 2. ✓
- CHANGELOG `## Unreleased` entry — Task 4. ✓
- One branch / one PR (`create-pilates-app`). ✓

**Placeholder scan:** `__PROJECT_NAME__` is the deliberate substitution token, not a plan placeholder. No TBD/TODO; every code step has complete content; every command has an expected result. ✓

**Type consistency:** `CreateAppOptions` (`targetDir` / `projectName`), `createApp`, `TEMPLATE_DIR`, `SUBSTITUTED` — names identical between `create-app.ts`, its test, and `index.ts`'s import. The CLI imports `createApp` from `./create-app.js` (the NodeNext `.js` specifier for the `.ts` source). The test imports the same. ✓
