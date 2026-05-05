# Error infrastructure (Phase 1) — design

**Date:** 2026-05-05
**Status:** Approved (brainstorming complete; pending plan)
**Target release:** `@pilates/react@0.4.0` (minor — additive class + factories; throw-message changes are non-breaking per SemVer policy below)
**Strategy alignment:** Track 2 tooling moat from the ambition pivot (`memory/project_pilates_ambition_pivot.md`) — DX differentiation over Ink, not parity work. Phase 1 of three; Phases 2 and 3 get their own specs.

## Goal

Lay the typed-error foundation that every later DX investment in the framework builds on. Today's throw sites are plain `Error('Pilates: ...')` strings: usable but inert — consumers can't discriminate by type, dev-only hints have no home, telemetry pipelines see `{}` when they serialize, and `instanceof Error` is the only catch shape we can offer. The 16+ existing throw sites all become call sites of typed factories, and the class is shaped for everything Phase 2 and 3 will pile on (`<ErrorOverview>` panel, friendly child-type validation, owner-stack capture).

The goal is **infrastructure parity with mature library error stories** (Node core, Apollo, Prisma) plus a small visible diagnostic — did-you-mean for unknown JSX host types — so the PR ships with a user-observable improvement and not just plumbing.

## Strategic decisions (locked)

| Decision | Choice | Rationale |
|---|---|---|
| Package owner | `@pilates/react` only — no surface in `@pilates/core` | Core's existing `RangeError`s name the bad value clearly enough. Pushing a class down would couple core to a string-error-codes convention it doesn't need. Re-exportable later if needed. |
| Class shape | One `PilatesError` with `code` discriminant; **no per-code subclasses** | Matches Node, Apollo, Prisma. Subclasses are reserved for fundamentally different `catch` lifecycles, which we don't have. |
| Cross-realm `instanceof` safety | `Symbol.for('pilates.error')` instance tag + exported `isPilatesError(e)` guard | Real failure mode under pnpm hoisting / dual-publish where two `PilatesError` classes coexist. `instanceof` still works in the common case; the guard works always. |
| Code form | `as const` object exporting both runtime values and a derived type | Best modern convention vs. `enum` (no IIFE bundle cost, no reverse-mapping footgun) and bare string union (gives JS users a runtime value to import). |
| Error decoder website | Skip | React's pattern saves browser bytes; Pilates errors are read in a terminal where the user already is. Maintenance > value at this scale. |
| Dev/prod gating | Inline `process.env.NODE_ENV !== 'production'` | Universally tree-shaken (webpack/rollup/esbuild/vite/bun). Conditional `exports` for dev/prod builds is non-breaking to add later if anyone asks for it. Matches existing precedent in `focus.tsx:184`. |
| Source maps | Don't ship `source-map-support`. Emit `.js.map` and document `node --enable-source-maps` for consumers | Library code mustn't mutate `Error.prepareStackTrace`. Node's built-in flag has been stable since 18 and is the official path. |
| Did-you-mean algorithm | Inline ~30-line Levenshtein with TypeScript's exact heuristics (case-insensitive exact match for `n<3`, `maxLenDiff = min(2, ⌊0.34n⌋)`, `maxDist = ⌊0.4n⌋ + 1`) | TS, ESLint, npm CLI, kubectl all converge on this band. Copying TS's tuning means our suggestions feel as good as `tsc`'s. No new dep. |
| Hint text | Dev-only `PILATES_ERROR_HINTS` table, gated at module load via `NODE_ENV` (table is `{}` in prod) | Hints get read in the terminal; no docs URL needed. Tree-shakes the whole table in prod. |
| `error.message` content | Stays terse + names the bad value, no hint baked in | `message` is for log-aggregator grouping; `hint` and `meta` carry the explanatory payload separately. Consistent with Sentry/Datadog/OpenTelemetry guidance. |
| Reconciler integration | Extend the `createContainer` `onCaughtError`/`onUncaughtError` callbacks (added in PR #37) to attach `errorInfo.componentStack` onto the error if it's a `PilatesError` | Ink does **not** do this — `errorInfo.componentStack` exists at the React layer but Ink's `ErrorOverview` ignores it. Differentiator. |
| Visible diagnostic in Phase 1 | Did-you-mean for unknown JSX host types only, including HTML→Pilates copy-paste mistakes (`<div>`/`<span>` → `<Box>`; `<p>` → `<Text>`) | Bounded set, not duplicated by TS (we don't register `JSX.IntrinsicElements`), high-frequency real-world bug class for React-DOM transplants. Color/border/flex value validation is a TS compile error today (those props are strict string unions in `@pilates/render` types) — runtime validation duplicates compile-time work. |
| SemVer of error surface | `error.code`, `error instanceof PilatesError`, `isPilatesError(e)`, structured fields are **public API**. `error.message` text is **not**. | Matches Node's documented policy. Lets us iterate phrasing without major bumps; gives consumers a stable hook. |

## Architecture

### Package layout

```
packages/react/src/
├── errors/                          # new directory
│   ├── index.ts                     # public re-exports
│   ├── pilates-error.ts             # class + Symbol tag + isPilatesError + toJSON
│   ├── codes.ts                     # PilatesErrorCode const + type + dev-only hints
│   ├── did-you-mean.ts              # ~30-line Levenshtein, no deps
│   ├── format.ts                    # formatPilatesError(err) → multi-line string
│   ├── pilates-error.test.ts
│   ├── codes.test.ts
│   ├── did-you-mean.test.ts
│   └── format.test.ts
├── error-boundary.tsx               # default fallback rewired to formatter
├── focus.tsx                        # 5 throws migrated
├── hooks.ts                         # 5 throws migrated
├── host-config.ts                   # 6+ throws migrated; did-you-mean wired
├── render.tsx                       # createContainer onCaughtError now attaches componentStack
└── index.ts                         # re-export PilatesError, PilatesErrorCode, isPilatesError, formatPilatesError
```

`packages/widgets/src/text-input.tsx`'s one throw also migrates — adds a `peerDependencies` consumer of `@pilates/react`'s error API, which is fine (already a peer dep).

## Component-by-component design

### `pilates-error.ts`

```ts
import { PILATES_ERROR_HINTS, type PilatesErrorCode } from './codes.js';

const PILATES_ERROR_TAG: unique symbol = Symbol.for('pilates.error');

export interface PilatesErrorOptions {
  /** Wrapped underlying error (ES2022 Error.cause). */
  cause?: unknown;
  /**
   * React component stack at the throw point. Set by the reconciler
   * `onCaughtError`/`onUncaughtError` glue, not by user code.
   */
  componentStack?: string;
  /**
   * Owner stack from React 19.1's captureOwnerStack(). Reserved field —
   * set by the same reconciler glue when the React version supports it.
   */
  ownerStack?: string;
  /** Structured error params (e.g. { received, suggestions: [...] }). */
  meta?: Record<string, unknown>;
}

export class PilatesError extends Error {
  override name = 'PilatesError';
  readonly code: PilatesErrorCode;
  readonly meta?: Record<string, unknown>;
  componentStack?: string;
  ownerStack?: string;
  /** Dev-only. Empty in prod (the hint table tree-shakes via NODE_ENV). */
  readonly hint?: string;
  readonly [PILATES_ERROR_TAG] = true as const;

  constructor(code: PilatesErrorCode, message: string, options: PilatesErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.code = code;
    this.meta = options.meta;
    this.componentStack = options.componentStack;
    this.ownerStack = options.ownerStack;
    if (process.env.NODE_ENV !== 'production') {
      this.hint = PILATES_ERROR_HINTS[code];
    }
    Error.captureStackTrace?.(this, new.target);
  }

  toJSON(): PilatesErrorJSON {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      hint: this.hint,
      meta: this.meta,
      componentStack: this.componentStack,
      ownerStack: this.ownerStack,
      stack: this.stack,
      cause: serializeCause(this.cause),
    };
  }
}

export interface PilatesErrorJSON { /* mirrors toJSON() shape */ }

export function isPilatesError(e: unknown): e is PilatesError {
  return typeof e === 'object' && e !== null && (e as Record<symbol, unknown>)[PILATES_ERROR_TAG] === true;
}

function serializeCause(c: unknown): unknown {
  if (c instanceof Error) return { name: c.name, message: c.message, stack: c.stack };
  return c;
}
```

**Notes on the shape:**

- `name = 'PilatesError'` so stack frames show `PilatesError:` not `Error:`.
- `super(message, { cause })` is the standard ES2022 path; `Error`'s base constructor handles property definition.
- `Error.captureStackTrace?.(this, new.target)` keeps the constructor itself out of the stack on V8; the optional chain makes it a no-op on non-V8 engines (Bun/Deno may still support it; SpiderMonkey doesn't).
- No `Object.setPrototypeOf` — needed only when transpiling down to ES5; we're on ES2022 target.
- Symbol tag uses `Symbol.for(...)` (cross-realm shared), so `isPilatesError` works even when two copies of the library load.

### `codes.ts`

```ts
export const PilatesErrorCode = {
  // Hooks
  HookOutsideRender: 'PILATES_HOOK_OUTSIDE_RENDER',
  // Focus
  FocusOutsideProvider: 'PILATES_FOCUS_OUTSIDE_PROVIDER',
  DuplicateFocusId: 'PILATES_DUPLICATE_FOCUS_ID',
  FocusInputBridgeOutsideProvider: 'PILATES_FOCUS_INPUT_BRIDGE_OUTSIDE_PROVIDER',
  // Host config
  UnknownHostType: 'PILATES_UNKNOWN_HOST_TYPE',
  BareStringAtRoot: 'PILATES_BARE_STRING_AT_ROOT',
  BareStringInBox: 'PILATES_BARE_STRING_IN_BOX',
  StringFragmentInvariant: 'PILATES_STRING_FRAGMENT_INVARIANT',
  // Text flatten
  InvalidTextChild: 'PILATES_INVALID_TEXT_CHILD',
  // Widgets
  TextInputBadProp: 'PILATES_TEXTINPUT_BAD_PROP',
} as const;

export type PilatesErrorCode = (typeof PilatesErrorCode)[keyof typeof PilatesErrorCode];

export const PILATES_ERROR_HINTS: Partial<Record<PilatesErrorCode, string>> =
  process.env.NODE_ENV !== 'production'
    ? {
        PILATES_HOOK_OUTSIDE_RENDER:
          'Hooks must be called inside a component rendered by `render()` from `@pilates/react`. Move the call into a child of <render> or wrap your tree.',
        PILATES_UNKNOWN_HOST_TYPE:
          'Pilates only knows the host elements provided by @pilates/react. If you copy-pasted from a React DOM app, replace HTML tags: `<div>` → `<Box>`, `<p>`/`<span>` → `<Text>`.',
        PILATES_BARE_STRING_AT_ROOT:
          'Wrap raw strings in <Text>: `<Text>hello</Text>`. Strings at the root have no styling context and would not render.',
        PILATES_BARE_STRING_IN_BOX:
          '<Box> is a layout container; it cannot render text directly. Wrap the string in <Text>: `<Box><Text>hello</Text></Box>`.',
        // ... (one per code; full list in implementation)
      }
    : {};
```

**Why `Partial<Record<...>>` for the hint table:** lets us add codes without immediately writing hints (the hint shows up in the ErrorOverview when present, just empty otherwise). New-code-without-hint is non-breaking.

### `did-you-mean.ts`

```ts
/**
 * Suggest the closest match from `candidates` to `input`, or undefined if none
 * is close enough. Heuristic ported from TypeScript's `getSpellingSuggestionForName`:
 *   - n < 3:               only case-insensitive exact match counts
 *   - maxLenDiff:          min(2, floor(0.34 * n))
 *   - maxDistance:         floor(0.4 * n) + 1
 */
export function didYouMean(input: string, candidates: readonly string[]): string | undefined {
  if (input.length < 3) {
    const lower = input.toLowerCase();
    return candidates.find((c) => c.toLowerCase() === lower);
  }
  const n = input.length;
  const maxLenDiff = Math.min(2, Math.floor(n * 0.34));
  let bestDist = Math.floor(n * 0.4) + 1;
  let best: string | undefined;
  const lowered = input.toLowerCase();
  for (const c of candidates) {
    if (Math.abs(c.length - n) > maxLenDiff) continue;
    const d = levenshtein(lowered, c.toLowerCase());
    if (d < bestDist) { bestDist = d; best = c; }
  }
  return best;
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const curr: number[] = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr.push(Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost));
    }
    prev = curr;
  }
  return prev[n];
}
```

### `format.ts`

```ts
/**
 * Multi-line human-readable formatting of a PilatesError, intended for
 * the default ErrorBoundary fallback and (Phase 2) the in-frame ErrorOverview.
 *
 * Format:
 *   Pilates: <message>
 *     hint: <hint>           (dev only; omitted if absent)
 *     caused by: <cause>     (recurses through error.cause chain)
 *
 * Plain Error / unknown values fall through to a single-line repr.
 */
export function formatPilatesError(err: unknown): string {
  if (isPilatesError(err)) {
    const lines = [`Pilates: ${err.message}`];
    if (err.hint) lines.push(`  hint: ${err.hint}`);
    if (err.cause !== undefined) lines.push(`  caused by: ${formatCause(err.cause)}`);
    return lines.join('\n');
  }
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}

function formatCause(c: unknown): string {
  if (isPilatesError(c)) return formatPilatesError(c).replace(/\n/g, '\n  ');
  if (c instanceof Error) return `${c.name}: ${c.message}`;
  return String(c);
}
```

### Default `ErrorBoundary` fallback

Currently:

```tsx
function DefaultFallback({ error }: ErrorBoundaryFallbackProps): ReactNode {
  return <Text bold color="red">{`Render error: ${error.message}`}</Text>;
}
```

Becomes:

```tsx
function DefaultFallback({ error }: ErrorBoundaryFallbackProps): ReactNode {
  // Single-line so it works in the tightest viewport. Phase 2's
  // <ErrorOverview> renders the full multi-line formatPilatesError output.
  if (isPilatesError(error)) {
    const tail = error.hint ? ` (${error.hint})` : '';
    return <Text bold color="red">{`Render error: ${error.message}${tail}`}</Text>;
  }
  return <Text bold color="red">{`Render error: ${error.message}`}</Text>;
}
```

Consumers wanting the full multi-line format pass their own `fallback={(err) => <Text>{formatPilatesError(err)}</Text>}`.

### Reconciler `onCaughtError` glue (PR #37 already wired the callback; this extends it)

The pattern is to **mutate the error in-place if it's a `PilatesError`**, attaching `componentStack` from `errorInfo`, *before* React continues bubbling it to the boundary. This is safe because `componentStack` is declared as mutable on `PilatesError` (specifically for this purpose) and the reconciler is the sole writer.

The existing handlers in `render.tsx:431-438` already accept `(err: Error, info: unknown)` per the 14-arg `createContainer` cast (PR #37). Phase 1 narrows the `info` type and reads `componentStack` off it. Each handler does the attachment **before** its existing side effect (the stderr write), so subsequent reads (consumer `onError`, telemetry, Phase 2 overlay) see the populated field:

```ts
type ErrorInfo = { componentStack?: string };

const attachComponentStack = (error: Error, info: ErrorInfo): void => {
  if (isPilatesError(error) && info.componentStack && !error.componentStack) {
    error.componentStack = info.componentStack;
  }
};

const onUncaughtError = (err: Error, info: ErrorInfo): void => {
  attachComponentStack(err, info);
  finishUnmount(err, true);
};

const onCaughtError = (err: Error, info: ErrorInfo): void => {
  attachComponentStack(err, info);
  stderr.write(`Pilates: caught render error: ${err.message}\n`);
};

const onRecoverableError = (err: Error, info: ErrorInfo): void => {
  attachComponentStack(err, info);
  stderr.write(`Pilates: recoverable render error: ${err.message}\n`);
};
```

**Why mutate vs. wrap:** wrapping would break `instanceof PilatesError` checks consumers might write inside `onError`. Reading `errorInfo.componentStack` ourselves and stashing it is non-invasive and gives `<ErrorOverview>` (Phase 2) something to render without re-plumbing in every fallback.

### Owner stack capture (deferred; field is reserved here)

`captureOwnerStack()` requires React 19.1+; we're on react-reconciler 0.31 paired with React 19.0. Phase 1 reserves the `ownerStack` field on `PilatesError` and `PilatesErrorOptions` so adding the capture in Phase 3 is non-breaking. Don't add the capture call now — it would no-op on the wrong React version and risk shipping dead code.

## Migration map

The 16 existing `throw new Error('Pilates: …')` sites in the repo, mapped to their new factory codes:

| File | Line(s) | Current message | New code |
|---|---|---|---|
| `react/src/hooks.ts` | 101 | `useApp() must be used inside <render>` | `HookOutsideRender` (`hookName: 'useApp'`) |
| `react/src/hooks.ts` | 107 | `useStdout()` | `HookOutsideRender` (`hookName: 'useStdout'`) |
| `react/src/hooks.ts` | 124 | `useStderr()` | `HookOutsideRender` |
| `react/src/hooks.ts` | 137 | `usePaste()` | `HookOutsideRender` |
| `react/src/hooks.ts` | 160 | `useInput()` | `HookOutsideRender` |
| `react/src/focus.tsx` | 185 | duplicate focus id | `DuplicateFocusId` (already had hint text) |
| `react/src/focus.tsx` | 227 | (focus ID conflict variant) | `DuplicateFocusId` |
| `react/src/focus.tsx` | 302 | `FocusInputBridge mounted outside FocusProvider` | `FocusInputBridgeOutsideProvider` |
| `react/src/focus.tsx` | 326 | `useFocus()` outside `<render>` | `HookOutsideRender` (`hookName: 'useFocus'`) |
| `react/src/focus.tsx` | 389 | `useFocusManager()` outside `<render>` | `HookOutsideRender` |
| `react/src/host-config.ts` | 190 | unknown host type | `UnknownHostType` (+ did-you-mean) |
| `react/src/host-config.ts` | 216, 222 | (variant invariants) | `StringFragmentInvariant` |
| `react/src/host-config.ts` | 240, 290 | bare strings at root | `BareStringAtRoot` |
| `react/src/host-config.ts` | 263, 268 | (Box children invariants) | `BareStringInBox` / `StringFragmentInvariant` |
| `react/src/host-config.ts` | 273, 293 | invariant strings | `StringFragmentInvariant` |
| `react/src/text-flatten.ts` | 23 | invalid Text child | `InvalidTextChild` |
| `widgets/src/text-input.tsx` | 63 | `TextInput: mask must be a single grapheme, got "..." (... graphemes)` | `TextInputBadProp` (`meta: { propName: 'mask', received, graphemeCount }`) |

**Migration guarantee:** every new `error.message` keeps the original payload (the offending value, the hook name, etc.) substring-intact, so any consumer test asserting on `expect(err.message).toContain('useApp')` continues to pass. The `Pilates:` prefix stays. New phrasing may add explanatory context after the substring; substring matchers tolerate that.

## Did-you-mean for unknown JSX host types

The trigger site is `host-config.ts:190` (`createInstance` with an unregistered type). The registered host types are the strings `pilates-box` and `pilates-text` (and `pilates-static` if/when that ships) — but **users don't author these directly**: they import `<Box>`/`<Text>` components from `@pilates/react`, which internally call `createElement('pilates-box', ...)`. The "unknown host type" error therefore fires when a user writes a *lowercase intrinsic JSX tag* (`<box>`, `<div>`, `<text>`, `<p>`) — copy-paste-from-DOM mistakes or capitalization slips.

The Levenshtein candidate set is therefore the **public component names** (`Box`, `Text`, `Static`), compared **case-insensitively** to the failing host-type string. The suggestion message names the component, not the host type.

**Two-pass suggestion:**

1. **HTML-tag mapping table.** Hard-coded for the most common DOM-React copy-paste mistakes:
   ```ts
   const HTML_TO_PILATES: Record<string, string> = {
     div: 'Box', section: 'Box', article: 'Box', main: 'Box', header: 'Box',
     footer: 'Box', nav: 'Box', aside: 'Box',
     p: 'Text', span: 'Text', strong: 'Text', em: 'Text', b: 'Text', i: 'Text',
     // ... small bounded set
   };
   ```
   If `type` matches a key, message becomes:
   `unknown host type "div" — Pilates is not HTML; use <Box> instead`.
2. **Levenshtein fallback** via `didYouMean(type, knownPilatesTypes)`. If a match is found:
   `unknown host type "Bx" — did you mean "Box"?`
3. Otherwise, plain message:
   `unknown host type "Bx"`.

The HTML→Pilates mapping table goes in `errors/host-type-suggestions.ts` (separate from the generic `did-you-mean.ts` because the data is host-config-specific and shouldn't pollute the generic utility).

## Public API and SemVer

**Public API additions (this PR):**
- `class PilatesError extends Error`
- `type PilatesErrorOptions`
- `interface PilatesErrorJSON`
- `const PilatesErrorCode` (the const object) and `type PilatesErrorCode`
- `function isPilatesError(e: unknown): e is PilatesError`
- `function formatPilatesError(err: unknown): string`

**SemVer commitments**, going forward (documented in CHANGELOG and a new section of the `@pilates/react` README):

| Surface | Stability |
|---|---|
| `error.code` value (the string ID) | Stable. Renaming a code = breaking change. |
| `error instanceof PilatesError` / `isPilatesError(e)` | Stable. |
| Structured fields (`code`, `meta`, `componentStack`, `ownerStack`) | Stable shape. Adding new optional fields is non-breaking. |
| `toJSON()` output shape | Stable. Adding new optional keys non-breaking. |
| `error.message` text | **NOT stable.** May be reworded freely. Document this prominently. |
| `error.hint` text and presence | **NOT stable.** Dev-only; reword anytime. |
| Stack-trace formatting | NOT stable. |
| Whether condition X throws *some* `PilatesError` | Stable. Which code it throws is also stable. |

This matches Node core's documented policy.

## Test plan

| Test | Coverage |
|---|---|
| `pilates-error.test.ts` | constructor sets `code`/`name`/`message`; `cause` forwarded via `super`; `instanceof Error` and `instanceof PilatesError` both true; `isPilatesError` true for class instances and false for plain `Error`/`null`/`undefined`/objects; `toJSON` shape stable (snapshot); `error.stack` does not contain the constructor frame |
| `codes.test.ts` | every code has a unique string value with `PILATES_` prefix; type-narrowing test (compile-time, via dts test) |
| `did-you-mean.test.ts` | exact match for `n<3`; suggests within threshold; rejects beyond threshold; case-insensitive; returns undefined for empty candidate set |
| `format.test.ts` | multi-line shape for `PilatesError`; cause chain renders recursively; plain `Error` falls through to single-line; arbitrary value `String(...)`s |
| Migration test pass | every existing test that asserts on error messages continues to pass (substring-intact guarantee) |
| Reconciler glue | when `<ErrorBoundary>` catches a `PilatesError`, the caught error's `.componentStack` is populated from `errorInfo.componentStack` |
| Did-you-mean integration | `<Box>` → `<bx>` typo: thrown error's message contains `did you mean "Box"`; `<div>`: contains `Pilates is not HTML; use <Box>`; gibberish: no suggestion phrase |
| Cross-realm `instanceof` | manually require/import a second copy via Node's loader to confirm `isPilatesError` works where `instanceof` would fail (skip if too brittle; document the test setup needed) |

## Phasing

**Phase 1 (this spec) — Foundation**, ships as `@pilates/react@0.4.0`:
- Class, codes, did-you-mean, format helper, migration, host-type diagnostic, componentStack capture.
- User-visible improvements: did-you-mean for `<bx>`/`<div>` typos; `error.code` for programmatic discrimination; `error.componentStack` for telemetry.

**Phase 2 — `<ErrorOverview>` component (separate spec; gated on Phase 1 baking with no SemVer regressions in consumer feedback)**, ships as `@pilates/react@0.5.0`:
- Ink-style in-frame panel with red badge, message + hint, source code-frame (±3 lines via `code-excerpt` + `stack-utils`), parsed/dimmed stack, component-stack tree, recursive cause chain rendering.
- Auto-mounted by `render()` for uncaught errors via `onUncaughtError`.
- Differentiator vs. Ink: shows `componentStack` (Ink doesn't), walks `error.cause` chain, dev-only hint inline.

**Phase 3 — High-value diagnostics (separate specs)**, demand-driven from here:
- Friendly child-type validation (catches "Objects are not valid as a React child" before React's opaque message).
- Owner stack capture via `captureOwnerStack()` once Pilates' react-reconciler version supports React 19.1+.
- `pilates-doctor` CLI for static project anti-pattern scans (1.x territory).

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Existing consumers' tests assert on exact `error.message` text and break under migration | Migration guarantee preserves the original payload substring + `Pilates:` prefix in every new message. Run repo's full suite before merge. |
| `instanceof PilatesError` fails under pnpm hoisting / dual-publish | Symbol.for-tagged class + exported `isPilatesError` guard. Document both patterns in the README; recommend the guard. |
| `process.env.NODE_ENV` not replaced by some bundler → hint table ships in prod bundle | Acceptable cost (~500 bytes for ~10 codes). Add conditional `exports` for dev/prod builds in a follow-up PR if anyone reports bundle-size bloat. |
| Mutating `componentStack` on a thrown error surprises consumers | Documented in `PilatesErrorOptions` JSDoc as "set by reconciler glue, not user code". Field is mutable by design. |
| Phase 2's `<ErrorOverview>` adds new dependencies (`code-excerpt`, `stack-utils`) | Phase 2 problem, not Phase 1. Both are tiny zero-dep packages from sindresorhus' constellation; documented when we get there. |
| Did-you-mean returns false-positive suggestions ("Bo" → "Box" but user meant something else entirely) | TS heuristic is well-tuned; threshold is conservative. Tests cover the boundary cases. False positive in the worst case is a redundant hint, not a correctness issue. |

## Out of scope (this spec)

- React-style error-decoder website / Babel plugin (skip).
- Runtime `source-map-support` patcher (skip; document Node flag).
- VError-style `info()` cause aggregation (skip).
- Per-code subclasses (one class is enough).
- Validating prop values that are TypeScript string unions (color, borderStyle, flexDirection, etc. — duplicates compile-time work).
- Migrating `@pilates/core`'s `RangeError`s — keeps core surface stable.
- The in-frame `<ErrorOverview>` — Phase 2.

## Implementation outline (for the plan that follows this spec)

1. Create `packages/react/src/errors/` with the four modules + their tests.
2. Migrate the 16+ throw sites to factory calls (mechanical, can be split into commits per file).
3. Wire the reconciler `onCaughtError`/`onUncaughtError` glue in `render.tsx`.
4. Update `ErrorBoundary` default fallback.
5. Re-export the public surface from `packages/react/src/index.ts`.
6. README section: "Error handling" — code/message stability, `instanceof` guidance, code reference table.
7. CHANGELOG entry under `## Unreleased` for `@pilates/react@0.4.0`.
8. Verify: `pnpm test` (expect 626 → ~640+), `pnpm typecheck`, `pnpm lint`.
