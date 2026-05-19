# typedoc API documentation site

## Problem

Pilates ships five public packages (`@pilates/core`, `@pilates/render`,
`@pilates/diff`, `@pilates/react`, `@pilates/widgets`) with a sizeable
typed public surface — components, hooks, the layout API, the
observability API — all carefully TSDoc-commented in source. None of
it is browsable: a prospective user reading the npm page or the repo
has no API reference. The long-deferred docs-site item (`A.6` in the
original plan) closes that gap.

## Approach

Generate a single unified HTML API reference with **typedoc**, its
native output (no extra docs framework — Pilates has no prose-docs
site to embed markdown into; a framework would be overhead for what is
purely an API reference). The site is built in CI and deployed to
**GitHub Pages** on every push to `main`, living at
`https://pilatesjs.github.io/pilates/`.

typedoc runs in **`packages` mode** (`entryPointStrategy: "packages"`)
— the idiomatic monorepo strategy: it documents each sub-package using
*that package's own `tsconfig`*, then merges the results into one
site. This sidesteps the "one tsconfig for the whole monorepo"
problem; each package already has a working build config.

Documenting from **source** (`src/index.ts`), not the emitted `.d.ts`,
keeps full TSDoc comments and source links.

## Packages documented

The five public, API-bearing packages only:

- `@pilates/core`, `@pilates/render`, `@pilates/diff`,
  `@pilates/react`, `@pilates/widgets`.

Excluded: `create-pilates-app` (a CLI — its `bin`, not an importable
API), `e2e`, `examples/*`, `bench`, `tools`.

## typedoc configuration

- **`typedoc` as a root `devDependency`** (latest compatible with the
  repo's `typescript ^5.7`).
- **Root `typedoc.json`** — `entryPointStrategy: "packages"`;
  `entryPoints` lists the five package directories; `out: "docs/api"`;
  `name: "Pilates"`; `excludeInternal: true`; `readme` set to the repo
  root `README.md` so the site's landing page is the project
  overview (no extra landing file to maintain).
- The root config's **`packageOptions`** sets
  `entryPoints: ["src/index.ts"]` for every package — so each package
  is documented from its source `index.ts`, with no per-package
  config files. (typedoc ≥ 0.26 supports `packageOptions`; should the
  installed version not, the equivalent fallback is a per-package
  `typedoc.json` carrying `entryPoints: ["src/index.ts"]` in each of
  the five packages.)
- `excludeInternal: true` drops every `@internal`-tagged symbol — the
  packages tag their internal surface heavily, and only the genuine
  public API belongs in the reference.
- **`docs/api/`** is the output directory — a build artifact, added to
  `.gitignore`; never committed.
- A root **`pnpm docs`** script runs typedoc. If typedoc needs the
  packages' emitted `.d.ts` to resolve cross-package `@pilates/*`
  types, the script (and the CI workflow) run `pnpm build` first; the
  implementation confirms whether the build step is required.

## Deployment — `.github/workflows/docs.yml`

A GitHub Actions workflow, triggered on push to `main`:

- Checkout; set up Node + pnpm matching `ci.yml`'s toolchain
  (pnpm 10.x, Node ≥ 22.13); `pnpm install`.
- Build the packages, then `pnpm docs`.
- Deploy `docs/api/` to GitHub Pages with
  `actions/upload-pages-artifact` + `actions/deploy-pages`.
- Declares `permissions: { contents: read, pages: write,
  id-token: write }` and a `github-pages` environment — the standard
  Pages-deploy shape. `concurrency` guards against overlapping
  deploys.

**One-time enablement:** the repo's Pages source must be set to
"GitHub Actions". Done once via `gh api`
(`PUT /repos/pilatesjs/pilates/pages` with `build_type: "workflow"`)
or in the repo Settings. The published site is
`https://pilatesjs.github.io/pilates/`.

## CI validation — `ci.yml`

The existing `.github/workflows/ci.yml` gains a docs-build step
(`pnpm docs`, build only, no deploy) so a pull request that breaks the
typedoc build — a malformed `@link`, a dangling reference, an entry
point that no longer resolves — fails CI, rather than silently
breaking the `main` deploy after merge.

## README link

The root `README.md` gets a link to the published API reference
(`https://pilatesjs.github.io/pilates/`), so npm and GitHub readers
can find it.

## Validation

- `pnpm docs` exits 0 and produces `docs/api/index.html`, with all
  five packages present and the `@internal` surface absent.
- `ci.yml` runs the docs build on every PR.
- `docs.yml` deploys on merge to `main`; the site is reachable at the
  Pages URL.

There is no unit test for a documentation site; the typedoc build
succeeding (and being gated in CI) is the check.

Ships as one branch / one PR — additive: new config files, a new
workflow, a `.gitignore` entry, a `package.json` devDependency +
script, a `ci.yml` step, and a README link. No package source
changes. The Pages-enablement `gh api` call and a first manual
`docs.yml` run happen after the PR merges.
