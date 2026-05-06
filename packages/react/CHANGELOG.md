# Changelog

All notable changes to `@pilates/react` are documented here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

### Errors (new public surface)

- **Added** `PilatesError` class with `.code`, dev-only `.hint`,
  structured `.meta`, and `.componentStack` populated by the reconciler.
- **Added** `PilatesErrorCode` const object + derived type — stable string
  IDs (e.g. `PILATES_HOOK_OUTSIDE_RENDER`, `PILATES_UNKNOWN_HOST_TYPE`).
- **Added** `isPilatesError(e)` type guard — prefer over `instanceof` for
  cross-realm safety (pnpm hoisting / dual-publish).
- **Added** `formatPilatesError(err)` — multi-line formatter for terminal
  output (used by the default `<ErrorBoundary>` fallback). Guards against
  circular cause chains.
- **Added** `suggestHostTypeReplacement(type)` and the underlying
  `didYouMean(input, candidates)` utility — composes an HTML→Pilates
  mapping (`<div>` → `<Box>`, `<p>`/`<span>` → `<Text>`, etc.) with a
  TypeScript-style Levenshtein heuristic for typos.
- **Added** Did-you-mean for unknown JSX host types: `<div>` produces
  *"Pilates is not HTML; use `<Box>` instead"*; typos like `bxo` produce
  *"did you mean `Box`?"*.
- **Added** `componentStack` capture from `react-reconciler`'s `errorInfo`
  onto thrown `PilatesError`s — visible to consumer
  `<ErrorBoundary onError>` handlers, telemetry, and Phase 2's overlay.
- **Changed** All 16 framework throw sites now produce `PilatesError`s
  rather than plain `Error`. The `Pilates: ` prefix moved out of the raw
  `error.message` and into `formatPilatesError()` — user-visible output
  via the default fallback is unchanged. Existing tests asserting on
  payload substrings (e.g. `/must be used inside <render>/`) continue
  to pass; one internal test asserting on the literal `"Pilates:"` prefix
  in `error.message` was updated to match the new payload-only form.
- **Changed** Default `<ErrorBoundary>` fallback now branches on
  `isPilatesError`: PilatesErrors render as `Pilates: <message> (<hint>)`
  in dev, while non-Pilates errors keep the legacy `Render error: <message>`
  form.
- **SemVer**: `error.code`, `instanceof PilatesError` / `isPilatesError`,
  and structured field shapes are public API. `error.message` text and
  `error.hint` text are not — they may be reworded in any minor.
- **Source maps**: Pilates emits `.js.map`. Run with
  `node --enable-source-maps` for `.ts`-pointing stack traces. No runtime
  `source-map-support` patch is bundled (libs must not mutate
  `Error.prepareStackTrace`).
