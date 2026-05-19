# typedoc API Documentation Site Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A unified typedoc HTML API reference for the five public `@pilates/*` packages, built in CI and deployed to GitHub Pages on every push to `main`.

**Architecture:** typedoc in `packages` mode generates one site from the five packages' `src/index.ts` (with `@internal` excluded) into `docs/api/`. A `pnpm docs` script runs it; `ci.yml` builds it on PRs to catch breakage; a new `docs.yml` workflow builds and deploys it to GitHub Pages.

**Tech Stack:** typedoc, TypeScript 5.7, pnpm workspace, GitHub Actions / GitHub Pages.

---

## File Structure

```
typedoc.json                  root typedoc config (packages mode)
package.json                  + typedoc devDependency, + "docs" script
pnpm-lock.yaml                updated by `pnpm install`
.gitignore                    + docs/api/
.github/workflows/docs.yml    NEW — build + deploy to GitHub Pages
.github/workflows/ci.yml      + a `pnpm docs` validation step
README.md                     + a link to the published API reference
```

No package source changes. There are no unit tests — a documentation-site setup has none; `pnpm docs` building cleanly (and being gated in `ci.yml`) is the check. Tasks therefore use a create-files → run → verify-output shape rather than a TDD red/green cycle.

Spec: `docs/superpowers/specs/2026-05-19-typedoc-api-docs-design.md`. Branch `typedoc-docs` (already created, spec committed). One PR.

---

### Task 1: typedoc config + `pnpm docs` script

**Files:**
- Modify: `package.json` (root) — add the `typedoc` devDependency and the `docs` script
- Create: `typedoc.json` (root)
- Modify: `.gitignore` — add `docs/api/`

- [ ] **Step 1: Add typedoc as a root devDependency**

Run: `pnpm add -D -w typedoc`
Expected: `typedoc` is added to the root `package.json` `devDependencies` and `pnpm-lock.yaml` is updated. (`-w` targets the workspace root.)

- [ ] **Step 2: Add the `docs` script to the root `package.json`**

In the root `package.json` `"scripts"` object, add a `"docs"` entry next to the existing scripts:

```json
    "docs": "typedoc",
```

(Place it after the `"typecheck"` script line, keeping valid JSON — a trailing comma on the previous line, none after the last entry.)

- [ ] **Step 3: Create the root `typedoc.json`**

Create `typedoc.json` at the repo root:

```json
{
  "$schema": "https://typedoc.org/schema.json",
  "entryPointStrategy": "packages",
  "entryPoints": [
    "packages/core",
    "packages/render",
    "packages/diff",
    "packages/react",
    "packages/widgets"
  ],
  "packageOptions": {
    "entryPoints": ["src/index.ts"]
  },
  "name": "Pilates",
  "out": "docs/api",
  "readme": "README.md",
  "excludeInternal": true
}
```

- [ ] **Step 4: Add `docs/api/` to `.gitignore`**

In `.gitignore`, add a line `docs/api/` after the existing `coverage/` line (it is a build artifact, like `coverage/` and `dist/`):

```
node_modules/
dist/
coverage/
docs/api/
*.tsbuildinfo
```

- [ ] **Step 5: Build the packages, then generate the docs**

Run: `pnpm build`
Expected: all packages build to their `dist/` (typedoc resolves cross-package `@pilates/*` types through the emitted `.d.ts`, so the build must run first).

Run: `pnpm docs`
Expected: typedoc exits 0 and writes the site to `docs/api/`.

If typedoc errors — e.g. `packageOptions` is unrecognised by the installed typedoc version, or an entry point does not resolve — adjust the config until `pnpm docs` produces the site. The fallback for an old typedoc without `packageOptions` is a per-package `typedoc.json` containing `{ "entryPoints": ["src/index.ts"] }` in each of `packages/{core,render,diff,react,widgets}/`, and dropping `packageOptions` from the root config. The success criterion is the verification in Step 6 — not the exact config text above.

- [ ] **Step 6: Verify the generated site**

Run: `ls docs/api && test -f docs/api/index.html && echo INDEX_OK`
Expected: `index.html` is present; prints `INDEX_OK`.

Run: `grep -rl "@pilates/core" docs/api | head -1 && grep -rl "@pilates/widgets" docs/api | head -1`
Expected: both print a match — all five packages are in the site (spot-checking the first and last).

Run: `grep -rl "calculateLayoutImperative" docs/api; echo "internal-hits=$?"`
Expected: `internal-hits=1` (grep found nothing) — `calculateLayoutImperative` is an `@internal` export of `@pilates/core`, so `excludeInternal` must have dropped it. If it appears in the output, `excludeInternal` is not working — fix the config.

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-lock.yaml typedoc.json .gitignore
git commit -m "$(cat <<'EOF'
docs: typedoc API reference config + `pnpm docs` script

typedoc in packages mode documents the five public @pilates/*
packages from source into docs/api/ (gitignored), with the
@internal surface excluded.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

If the typedoc-config fallback from Step 5 was needed, `git add` the per-package `typedoc.json` files in that same commit.

---

### Task 2: GitHub Pages deploy + CI validation + README link

**Files:**
- Create: `.github/workflows/docs.yml`
- Modify: `.github/workflows/ci.yml` — add a docs-build step
- Modify: `README.md` — add a link to the published reference

- [ ] **Step 1: Create the deploy workflow `.github/workflows/docs.yml`**

```yaml
name: Docs

on:
  push:
    branches: [main]

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build-deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deploy.outputs.page_url }}
    steps:
      - uses: actions/checkout@v6

      - uses: pnpm/action-setup@v6

      - uses: actions/setup-node@v6
        with:
          node-version: 22
          cache: pnpm

      - run: pnpm install --frozen-lockfile

      - run: pnpm build

      - run: pnpm docs

      - uses: actions/configure-pages@v5

      - uses: actions/upload-pages-artifact@v3
        with:
          path: docs/api

      - id: deploy
        uses: actions/deploy-pages@v4
```

- [ ] **Step 2: Add a docs-build step to `.github/workflows/ci.yml`**

In `.github/workflows/ci.yml`, the `test` job runs `pnpm build` then `pnpm typecheck`. Add a `pnpm docs` step immediately after the `pnpm build` step (the docs build needs the packages built first):

```yaml
      - run: pnpm build

      - run: pnpm docs

      - run: pnpm typecheck
```

(Insert only the `- run: pnpm docs` line + its surrounding blank line — leave every other step in `ci.yml` unchanged.)

- [ ] **Step 3: Add the API-reference link to `README.md`**

In `README.md`, immediately after the tagline blockquote (the two-line `> Headless flex layout engine for terminal UIs. Pure TypeScript, zero runtime > dependencies.` block), add a centered link line:

```html
<p align="center">
  <a href="https://pilatesjs.github.io/pilates/"><strong>📖 API reference</strong></a>
</p>
```

- [ ] **Step 4: Validate the YAML and the CI edit**

Run: `node -e "const fs=require('node:fs'); for (const f of ['.github/workflows/docs.yml','.github/workflows/ci.yml']) { fs.readFileSync(f,'utf8'); } console.log('files readable');"`
Expected: prints `files readable` (a basic existence/read check).

Run: `grep -n "pnpm docs" .github/workflows/ci.yml`
Expected: one match — the docs step is present in `ci.yml`, positioned between `pnpm build` and `pnpm typecheck`.

Run: `grep -c "deploy-pages" .github/workflows/docs.yml`
Expected: `1` — the deploy workflow references `deploy-pages`.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/docs.yml .github/workflows/ci.yml README.md
git commit -m "$(cat <<'EOF'
ci: build the API docs in CI; deploy to GitHub Pages on main

A new `docs` workflow publishes the typedoc site to GitHub Pages on
push to main; `ci.yml` now runs `pnpm docs` so a PR that breaks the
docs build fails. README links the published reference.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Post-merge (not part of this plan's tasks — the controller handles it)

After the PR merges, GitHub Pages must be enabled with its source set to "GitHub Actions" — once, via `gh api` (`PUT /repos/pilatesjs/pilates/pages` with `build_type: "workflow"`) or the repo Settings. The `docs.yml` workflow then publishes to `https://pilatesjs.github.io/pilates/` on that and every subsequent push to `main`.

---

## Self-Review

**Spec coverage:**
- typedoc as a root devDependency — Task 1 Step 1. ✓
- Root `typedoc.json`, `packages` mode, five public packages, `packageOptions` entry from `src/index.ts`, `excludeInternal`, `out: docs/api`, `name`, `readme` — Task 1 Step 3. ✓
- `docs/api/` gitignored — Task 1 Step 4. ✓
- `pnpm docs` script — Task 1 Step 2. ✓
- `docs.yml` GitHub Pages deploy workflow (`permissions`, `concurrency`, `github-pages` environment, `upload-pages-artifact` + `deploy-pages`) — Task 2 Step 1. ✓
- `ci.yml` docs-build validation step — Task 2 Step 2. ✓
- README link to the published reference — Task 2 Step 3. ✓
- Pages enablement (`gh api`) — noted as a post-merge controller step. ✓
- Excluded packages (`create-pilates-app`, `e2e`, examples) — the `entryPoints` list names only the five; nothing else is included. ✓

**Placeholder scan:** No TBD/TODO. Step 5 of Task 1 names a concrete fallback (per-package configs) rather than leaving it vague — config tooling legitimately needs a verified-by-output success criterion. Every step has exact commands and expected output.

**Type/name consistency:** `docs/api` is the typedoc `out`, the `.gitignore` entry, and the `upload-pages-artifact` `path` — identical across Tasks 1 and 2. The `docs` script name is consistent between `package.json`, `ci.yml`, and `docs.yml`. `pnpm build` precedes `pnpm docs` everywhere it is run (Task 1 Step 5, `ci.yml`, `docs.yml`).
