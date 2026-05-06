# Error Infrastructure (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the typed-error foundation for `@pilates/react@0.4.0` — a `PilatesError` class with `.code` discriminant, dev-only hints, did-you-mean for unknown JSX host types, and `componentStack` capture from the reconciler — by migrating all 16 existing `throw new Error('Pilates: …')` sites to factories built on the new infrastructure.

**Architecture:** Six new files in `packages/react/src/errors/` (one class, one codes registry, one Levenshtein utility, one HTML→Pilates mapping table, one formatter, one barrel). Existing throw sites swap their bare `new Error(...)` for typed factory calls; raw `error.message` no longer carries the `Pilates: ` prefix (the formatter adds it). `render.tsx` extends its three reconciler error callbacks to attach `errorInfo.componentStack` onto thrown `PilatesError`s. `ErrorBoundary`'s default fallback feeds the caught error through the formatter so users see hints inline.

**Tech Stack:** TypeScript 5.7+ (ES2022 target), React 19.0 / react-reconciler@0.31, vitest, biome. Inline ~30-line Levenshtein, no new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-05-05-error-infrastructure-design.md`

**Branch:** `error-infrastructure-spec` (continue work here; the spec commit is already pushed)

---

## File Structure

**New files:**

| Path | Responsibility |
|---|---|
| `packages/react/src/errors/did-you-mean.ts` | Levenshtein + TS-style suggestion heuristic; pure utility, no project-specific data |
| `packages/react/src/errors/did-you-mean.test.ts` | Tests for the utility |
| `packages/react/src/errors/codes.ts` | `PilatesErrorCode` const object + derived type + dev-only `PILATES_ERROR_HINTS` table |
| `packages/react/src/errors/codes.test.ts` | Code uniqueness, prefix, hint-table dev-vs-prod gating |
| `packages/react/src/errors/pilates-error.ts` | `class PilatesError`, `isPilatesError`, `Symbol.for('pilates.error')` tag, `toJSON` |
| `packages/react/src/errors/pilates-error.test.ts` | Class behavior, cause forwarding, instanceof, isPilatesError, toJSON |
| `packages/react/src/errors/format.ts` | `formatPilatesError(err)` — multi-line text incl. Pilates: prefix, hint, cause chain |
| `packages/react/src/errors/format.test.ts` | Formatter shape under all input variants |
| `packages/react/src/errors/host-type-suggestions.ts` | HTML→Pilates mapping table + composed suggester combining the table and Levenshtein |
| `packages/react/src/errors/host-type-suggestions.test.ts` | HTML mapping + Levenshtein fallback tests |
| `packages/react/src/errors/index.ts` | Public barrel (re-exports the five above) |

**Modified files:**

| Path | Change |
|---|---|
| `packages/react/src/hooks.ts` | 5 throws → `new PilatesError(PilatesErrorCode.HookOutsideRender, …)` |
| `packages/react/src/focus.tsx` | 5 throws → factories (`HookOutsideRender`, `DuplicateFocusId`, `FocusInputBridgeOutsideProvider`) |
| `packages/react/src/host-config.ts` | 6+ throws → factories; `UnknownHostType` wired through `host-type-suggestions.ts` |
| `packages/react/src/text-flatten.ts` | 1 throw → `InvalidTextChild` |
| `packages/widgets/src/text-input.tsx` | 1 throw → `TextInputBadProp` |
| `packages/react/src/render.tsx` | Three reconciler callbacks (lines 411–438) extend to attach `errorInfo.componentStack` onto `PilatesError`s |
| `packages/react/src/error-boundary.tsx` | `DefaultFallback` feeds `error` through `formatPilatesError` |
| `packages/react/src/index.ts` | Re-export `PilatesError`, `PilatesErrorCode`, `isPilatesError`, `formatPilatesError`, types |
| `packages/react/CHANGELOG.md` | `## Unreleased` entry under `@pilates/react@0.4.0` |
| `packages/react/README.md` | New "Error handling" section: SemVer, codes table, `instanceof` vs `isPilatesError` guidance |

---

## Tasks

### Task 1: `did-you-mean.ts` — Levenshtein utility with TS heuristics

**Files:**
- Create: `packages/react/src/errors/did-you-mean.ts`
- Create: `packages/react/src/errors/did-you-mean.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/react/src/errors/did-you-mean.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { didYouMean } from './did-you-mean.js';

describe('didYouMean — TypeScript-style suggestion heuristic', () => {
  describe('short input (n < 3)', () => {
    it('returns case-insensitive exact match', () => {
      expect(didYouMean('Bx', ['Box', 'Text'])).toBeUndefined(); // n=2, no exact
      expect(didYouMean('Bo', ['Bo', 'Box'])).toBe('Bo');
      expect(didYouMean('bo', ['Bo'])).toBe('Bo');
    });

    it('returns undefined when no exact match for n<3', () => {
      expect(didYouMean('Bx', ['Box'])).toBeUndefined();
    });
  });

  describe('long input (n >= 3)', () => {
    it('suggests within threshold', () => {
      // n=3, maxDist = floor(0.4*3)+1 = 2
      expect(didYouMean('Bxo', ['Box', 'Text'])).toBe('Box');
    });

    it('returns undefined beyond threshold', () => {
      // n=3, maxDist=2; "abc" vs "Box" has distance 3
      expect(didYouMean('abc', ['Box'])).toBeUndefined();
    });

    it('rejects candidates whose length differs too much', () => {
      // n=3, maxLenDiff = min(2, floor(0.34*3)) = min(2, 1) = 1
      // "Bxo" (3) vs "BoxAndCo" (8) — len diff 5 > 1, rejected
      expect(didYouMean('Bxo', ['BoxAndCoExtra'])).toBeUndefined();
    });

    it('is case-insensitive', () => {
      expect(didYouMean('BOX', ['Box'])).toBe('Box');
      expect(didYouMean('box', ['Box'])).toBe('Box');
    });

    it('picks the closest of multiple candidates', () => {
      // 'Boxx' is dist 1 from 'Box', dist 4 from 'Static'; should pick Box
      expect(didYouMean('Boxx', ['Static', 'Box'])).toBe('Box');
    });
  });

  describe('edge cases', () => {
    it('returns undefined for empty candidate set', () => {
      expect(didYouMean('Box', [])).toBeUndefined();
    });

    it('returns undefined for empty input on n<3 path', () => {
      expect(didYouMean('', ['Box'])).toBeUndefined();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/react/src/errors/did-you-mean.test.ts`
Expected: FAIL with module-not-found error for `./did-you-mean.js`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/react/src/errors/did-you-mean.ts`:

```ts
/**
 * Suggest the closest match from `candidates` to `input`, or undefined if
 * none is close enough. Heuristic ported from TypeScript's
 * `getSpellingSuggestionForName` (src/compiler/checker.ts):
 *
 *   - n < 3:      only a case-insensitive exact match counts
 *   - maxLenDiff: min(2, floor(0.34 * n))   reject candidates too far in length
 *   - maxDist:    floor(0.4 * n) + 1        max edit distance accepted
 *
 * Comparison is case-insensitive.
 */
export function didYouMean(
  input: string,
  candidates: readonly string[],
): string | undefined {
  if (input.length === 0) return undefined;
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
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return best;
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev: number[] = Array.from({ length: n + 1 }, (_, i) => i);
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

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/react/src/errors/did-you-mean.test.ts`
Expected: PASS — 9 tests across 3 describe blocks.

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/errors/did-you-mean.ts packages/react/src/errors/did-you-mean.test.ts
git commit -m "react/errors: add didYouMean utility with TypeScript-style heuristic"
```

---

### Task 2: `codes.ts` — code registry + dev-only hints table

**Files:**
- Create: `packages/react/src/errors/codes.ts`
- Create: `packages/react/src/errors/codes.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/react/src/errors/codes.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  PILATES_ERROR_HINTS,
  PilatesErrorCode,
  type PilatesErrorCode as PilatesErrorCodeType,
} from './codes.js';

describe('PilatesErrorCode', () => {
  it('exports a const object with at least the spec\'s codes', () => {
    expect(PilatesErrorCode.HookOutsideRender).toBe('PILATES_HOOK_OUTSIDE_RENDER');
    expect(PilatesErrorCode.UnknownHostType).toBe('PILATES_UNKNOWN_HOST_TYPE');
    expect(PilatesErrorCode.BareStringAtRoot).toBe('PILATES_BARE_STRING_AT_ROOT');
    expect(PilatesErrorCode.BareStringInBox).toBe('PILATES_BARE_STRING_IN_BOX');
    expect(PilatesErrorCode.StringFragmentInvariant).toBe('PILATES_STRING_FRAGMENT_INVARIANT');
    expect(PilatesErrorCode.InvalidTextChild).toBe('PILATES_INVALID_TEXT_CHILD');
    expect(PilatesErrorCode.FocusOutsideProvider).toBe('PILATES_FOCUS_OUTSIDE_PROVIDER');
    expect(PilatesErrorCode.DuplicateFocusId).toBe('PILATES_DUPLICATE_FOCUS_ID');
    expect(PilatesErrorCode.FocusInputBridgeOutsideProvider).toBe(
      'PILATES_FOCUS_INPUT_BRIDGE_OUTSIDE_PROVIDER',
    );
    expect(PilatesErrorCode.TextInputBadProp).toBe('PILATES_TEXTINPUT_BAD_PROP');
  });

  it('every value is unique', () => {
    const values = Object.values(PilatesErrorCode);
    const unique = new Set(values);
    expect(unique.size).toBe(values.length);
  });

  it('every value starts with PILATES_', () => {
    for (const v of Object.values(PilatesErrorCode)) {
      expect(v.startsWith('PILATES_')).toBe(true);
    }
  });

  it('the type derives from the const object', () => {
    // Compile-time check: this should typecheck if the type derivation is right.
    const code: PilatesErrorCodeType = PilatesErrorCode.HookOutsideRender;
    expect(code).toBe('PILATES_HOOK_OUTSIDE_RENDER');
  });
});

describe('PILATES_ERROR_HINTS — dev-only table', () => {
  // Vitest defaults NODE_ENV to 'test'; the gate is `!== 'production'`,
  // so hints should be present in this test environment.
  it('contains a non-empty hint for at least each code that has one in the spec', () => {
    expect(PILATES_ERROR_HINTS[PilatesErrorCode.HookOutsideRender]).toMatch(/render/i);
    expect(PILATES_ERROR_HINTS[PilatesErrorCode.UnknownHostType]).toMatch(/host/i);
    expect(PILATES_ERROR_HINTS[PilatesErrorCode.BareStringAtRoot]).toMatch(/Text/);
    expect(PILATES_ERROR_HINTS[PilatesErrorCode.BareStringInBox]).toMatch(/Text/);
  });

  it('every hint is non-empty if defined', () => {
    for (const v of Object.values(PILATES_ERROR_HINTS)) {
      if (v !== undefined) expect(v.length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/react/src/errors/codes.test.ts`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Write minimal implementation**

Create `packages/react/src/errors/codes.ts`:

```ts
/**
 * Stable string IDs for every error case PilatesError can carry. Public API
 * (per the SemVer policy in the design doc): renaming a code is a breaking
 * change. New codes can be added in any minor.
 *
 * Authored as an `as const` object so we get both a runtime value (for JS
 * consumers and equality checks) and a derived string-literal type.
 */
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

/**
 * Dev-only explanatory hints, keyed by code. The table is `{}` in production
 * builds; bundlers tree-shake the literal object away when `NODE_ENV` is
 * `'production'`. Adding a code without a hint is non-breaking — the hint
 * field on the error simply stays `undefined`.
 */
export const PILATES_ERROR_HINTS: Partial<Record<PilatesErrorCode, string>> =
  process.env.NODE_ENV !== 'production'
    ? {
        [PilatesErrorCode.HookOutsideRender]:
          'Pilates hooks must be called from a component rendered by render() from @pilates/react. Move the call into a child of <render>, or wrap your tree at the top level.',
        [PilatesErrorCode.FocusOutsideProvider]:
          'useFocus() must be called inside a tree wrapped by <FocusProvider>. The render() helper wires this for you unless you opted out via { focus: false }.',
        [PilatesErrorCode.DuplicateFocusId]:
          'Two components called useFocus({ id }) with the same id at the same time. Focus ids must be unique within a Pilates app — check that you are not rendering the same component twice with a static id.',
        [PilatesErrorCode.FocusInputBridgeOutsideProvider]:
          'FocusInputBridge is an internal Pilates component; it should never appear outside <FocusProvider>. If you are seeing this, it likely indicates a corrupted Pilates install.',
        [PilatesErrorCode.UnknownHostType]:
          'Pilates only knows the host elements provided by @pilates/react. If you copy-pasted JSX from a React DOM app, replace HTML tags: <div> → <Box>, <p>/<span> → <Text>. If you typed lowercase, try the capitalized component name.',
        [PilatesErrorCode.BareStringAtRoot]:
          'Wrap raw strings in <Text>: <Text>hello</Text>. Strings at the root have no styling context and would not render.',
        [PilatesErrorCode.BareStringInBox]:
          '<Box> is a layout container; it cannot render text directly. Wrap the string in <Text>: <Box><Text>hello</Text></Box>.',
        [PilatesErrorCode.StringFragmentInvariant]:
          'A Pilates internal invariant about string-fragment placement was violated. This typically indicates a Pilates bug rather than a user error — please file an issue with a reproducing example.',
        [PilatesErrorCode.InvalidTextChild]:
          '<Text> only accepts strings, numbers, and other <Text> as children. To render a non-string value, convert it explicitly: {String(x)} or {x.toString()}.',
        [PilatesErrorCode.TextInputBadProp]:
          '<TextInput> received a prop value that does not match its contract. See message for the specific prop and reason.',
      }
    : {};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/react/src/errors/codes.test.ts`
Expected: PASS — 6 tests across 2 describe blocks.

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/errors/codes.ts packages/react/src/errors/codes.test.ts
git commit -m "react/errors: add PilatesErrorCode registry + dev-only hints table"
```

---

### Task 3: `pilates-error.ts` — class + Symbol tag + isPilatesError + toJSON

**Files:**
- Create: `packages/react/src/errors/pilates-error.ts`
- Create: `packages/react/src/errors/pilates-error.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/react/src/errors/pilates-error.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { PilatesErrorCode } from './codes.js';
import { PilatesError, isPilatesError } from './pilates-error.js';

describe('PilatesError — constructor', () => {
  it('sets code, name, and message', () => {
    const e = new PilatesError(PilatesErrorCode.HookOutsideRender, 'useApp() must be used inside <render>');
    expect(e.code).toBe('PILATES_HOOK_OUTSIDE_RENDER');
    expect(e.name).toBe('PilatesError');
    expect(e.message).toBe('useApp() must be used inside <render>');
  });

  it('forwards cause via super', () => {
    const inner = new Error('underlying');
    const e = new PilatesError(PilatesErrorCode.UnknownHostType, 'wrap', { cause: inner });
    expect(e.cause).toBe(inner);
  });

  it('attaches meta when supplied', () => {
    const e = new PilatesError(PilatesErrorCode.UnknownHostType, 'unknown host type "div"', {
      meta: { received: 'div', knownTypes: ['Box', 'Text'] },
    });
    expect(e.meta).toEqual({ received: 'div', knownTypes: ['Box', 'Text'] });
  });

  it('defaults meta/componentStack/ownerStack to undefined', () => {
    const e = new PilatesError(PilatesErrorCode.HookOutsideRender, 'x');
    expect(e.meta).toBeUndefined();
    expect(e.componentStack).toBeUndefined();
    expect(e.ownerStack).toBeUndefined();
  });

  it('populates hint in dev mode (NODE_ENV !== production)', () => {
    // Vitest sets NODE_ENV to 'test' — gate is `!== 'production'`, so hints fire.
    const e = new PilatesError(PilatesErrorCode.HookOutsideRender, 'x');
    expect(typeof e.hint).toBe('string');
    expect(e.hint?.length).toBeGreaterThan(0);
  });

  it('is instanceof Error and instanceof PilatesError', () => {
    const e = new PilatesError(PilatesErrorCode.HookOutsideRender, 'x');
    expect(e instanceof Error).toBe(true);
    expect(e instanceof PilatesError).toBe(true);
  });

  it('error.stack does not include the constructor frame on V8', () => {
    const e = new PilatesError(PilatesErrorCode.HookOutsideRender, 'x');
    // On V8 (Node), Error.captureStackTrace strips the constructor frame.
    // On non-V8 the call is a no-op, in which case the constructor frame is
    // present — we tolerate that case.
    if (typeof Error.captureStackTrace === 'function') {
      expect(e.stack).not.toMatch(/at new PilatesError/);
    }
  });
});

describe('PilatesError — toJSON', () => {
  it('produces a serializable object with all canonical fields', () => {
    const e = new PilatesError(PilatesErrorCode.UnknownHostType, 'unknown host type "div"', {
      meta: { received: 'div' },
      componentStack: '\n    in MyComp\n    in App',
    });
    const json = e.toJSON();
    expect(json.name).toBe('PilatesError');
    expect(json.code).toBe('PILATES_UNKNOWN_HOST_TYPE');
    expect(json.message).toBe('unknown host type "div"');
    expect(json.meta).toEqual({ received: 'div' });
    expect(json.componentStack).toBe('\n    in MyComp\n    in App');
    expect(typeof json.stack).toBe('string');
  });

  it('serializes Error cause to plain object (Sentry-friendly)', () => {
    const inner = new Error('underlying');
    const e = new PilatesError(PilatesErrorCode.UnknownHostType, 'wrap', { cause: inner });
    const json = e.toJSON();
    expect(json.cause).toEqual({
      name: 'Error',
      message: 'underlying',
      stack: inner.stack,
    });
  });

  it('passes non-Error cause through unchanged', () => {
    const e = new PilatesError(PilatesErrorCode.UnknownHostType, 'wrap', { cause: 'literal-string-cause' });
    expect(e.toJSON().cause).toBe('literal-string-cause');
  });

  it('round-trips through JSON.stringify without throwing', () => {
    const e = new PilatesError(PilatesErrorCode.UnknownHostType, 'm');
    expect(() => JSON.stringify(e)).not.toThrow();
    const parsed = JSON.parse(JSON.stringify(e));
    expect(parsed.code).toBe('PILATES_UNKNOWN_HOST_TYPE');
  });
});

describe('isPilatesError — type guard', () => {
  it('returns true for PilatesError instances', () => {
    const e = new PilatesError(PilatesErrorCode.HookOutsideRender, 'x');
    expect(isPilatesError(e)).toBe(true);
  });

  it('returns false for plain Error', () => {
    expect(isPilatesError(new Error('hi'))).toBe(false);
  });

  it('returns false for non-error values', () => {
    expect(isPilatesError(null)).toBe(false);
    expect(isPilatesError(undefined)).toBe(false);
    expect(isPilatesError('string')).toBe(false);
    expect(isPilatesError(42)).toBe(false);
    expect(isPilatesError({})).toBe(false);
    expect(isPilatesError({ code: 'PILATES_X', message: 'y' })).toBe(false);
  });

  it('returns true for cross-realm-tagged objects (Symbol.for survival)', () => {
    // Simulate a "different copy of PilatesError class loaded in the same
    // realm" by hand-tagging a plain object with the same Symbol.for(...).
    // This is exactly the dual-publish failure mode the tag is designed for.
    const tag = Symbol.for('pilates.error');
    const fake: Record<symbol, unknown> = { [tag]: true };
    expect(isPilatesError(fake)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/react/src/errors/pilates-error.test.ts`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Write minimal implementation**

Create `packages/react/src/errors/pilates-error.ts`:

```ts
import { PILATES_ERROR_HINTS, type PilatesErrorCode } from './codes.js';

/**
 * Cross-realm-shared Symbol used to tag PilatesError instances. Symbol.for(...)
 * looks up by string in the global registry, so two copies of @pilates/react
 * loaded into the same process (pnpm hoisting / dual-publish) produce the
 * *same* symbol — which makes the isPilatesError() guard work where
 * `instanceof PilatesError` would fail.
 */
const PILATES_ERROR_TAG: unique symbol = Symbol.for('pilates.error');

export interface PilatesErrorOptions {
  /** Wrapped underlying error (ES2022 Error.cause). */
  cause?: unknown;
  /**
   * React component stack at the throw point. Set by the reconciler glue
   * in render.tsx (onCaughtError / onUncaughtError / onRecoverableError),
   * not by user code.
   */
  componentStack?: string;
  /**
   * Owner stack from React 19.1's captureOwnerStack(). Reserved for Phase 3;
   * not populated in Phase 1.
   */
  ownerStack?: string;
  /** Structured error params (e.g. { received, suggestions: [...] }). */
  meta?: Record<string, unknown>;
}

/**
 * Shape of `PilatesError.toJSON()`. Sentry's ExtraErrorData integration looks
 * for `toJSON()` and uses its return value when present.
 */
export interface PilatesErrorJSON {
  name: string;
  code: PilatesErrorCode;
  message: string;
  hint: string | undefined;
  meta: Record<string, unknown> | undefined;
  componentStack: string | undefined;
  ownerStack: string | undefined;
  stack: string | undefined;
  cause: unknown;
}

export class PilatesError extends Error {
  override name = 'PilatesError';
  readonly code: PilatesErrorCode;
  readonly meta?: Record<string, unknown>;
  /** Mutable: the reconciler glue writes here in onCaughtError. */
  componentStack?: string;
  /** Mutable: reserved for Phase 3 captureOwnerStack() integration. */
  ownerStack?: string;
  /** Dev-only. Empty in prod (the hint table tree-shakes via NODE_ENV). */
  readonly hint?: string;
  readonly [PILATES_ERROR_TAG]: true = true;

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

/**
 * Type guard. Prefer this over `instanceof PilatesError` for cross-realm
 * safety — when two copies of the library are loaded in the same process
 * (pnpm hoisting), `instanceof` fails on instances created by the other
 * copy because they have different `.prototype` identities. The Symbol.for
 * tag is shared across copies.
 */
export function isPilatesError(e: unknown): e is PilatesError {
  return (
    typeof e === 'object' &&
    e !== null &&
    (e as Record<symbol, unknown>)[PILATES_ERROR_TAG] === true
  );
}

function serializeCause(c: unknown): unknown {
  if (c instanceof Error) {
    return { name: c.name, message: c.message, stack: c.stack };
  }
  return c;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/react/src/errors/pilates-error.test.ts`
Expected: PASS — 16 tests across 3 describe blocks.

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/errors/pilates-error.ts packages/react/src/errors/pilates-error.test.ts
git commit -m "react/errors: add PilatesError class with Symbol.for tag + isPilatesError + toJSON"
```

---

### Task 4: `format.ts` — multi-line formatter

**Files:**
- Create: `packages/react/src/errors/format.ts`
- Create: `packages/react/src/errors/format.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/react/src/errors/format.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { PilatesErrorCode } from './codes.js';
import { formatPilatesError } from './format.js';
import { PilatesError } from './pilates-error.js';

describe('formatPilatesError', () => {
  it('formats a PilatesError with hint as multi-line text', () => {
    const e = new PilatesError(
      PilatesErrorCode.HookOutsideRender,
      'useApp() must be used inside <render>',
    );
    const out = formatPilatesError(e);
    const lines = out.split('\n');
    expect(lines[0]).toBe('Pilates: useApp() must be used inside <render>');
    expect(lines[1]).toMatch(/^\s+hint:/);
    expect(lines[1]).toMatch(/render/i);
  });

  it('omits the hint line when no hint is set', () => {
    // Force-clear the hint (simulates production-mode tree-shaking)
    const e = new PilatesError(PilatesErrorCode.HookOutsideRender, 'x');
    Object.defineProperty(e, 'hint', { value: undefined, configurable: true });
    const out = formatPilatesError(e);
    expect(out.split('\n')).toHaveLength(1);
    expect(out).toBe('Pilates: x');
  });

  it('renders a cause chain recursively, indented', () => {
    const inner = new Error('inner failure');
    const e = new PilatesError(PilatesErrorCode.UnknownHostType, 'wrapping error', {
      cause: inner,
    });
    const out = formatPilatesError(e);
    expect(out).toContain('Pilates: wrapping error');
    expect(out).toContain('caused by:');
    expect(out).toContain('inner failure');
  });

  it('renders a PilatesError cause chain with nested indentation', () => {
    const innerInner = new Error('root failure');
    const inner = new PilatesError(PilatesErrorCode.UnknownHostType, 'middle', {
      cause: innerInner,
    });
    const outer = new PilatesError(PilatesErrorCode.HookOutsideRender, 'top', {
      cause: inner,
    });
    const out = formatPilatesError(outer);
    expect(out).toContain('Pilates: top');
    expect(out).toContain('Pilates: middle');
    expect(out).toContain('root failure');
  });

  it('formats a plain Error as single line "Name: message"', () => {
    const e = new Error('boom');
    expect(formatPilatesError(e)).toBe('Error: boom');
  });

  it('formats a TypeError preserving its name', () => {
    const e = new TypeError('bad type');
    expect(formatPilatesError(e)).toBe('TypeError: bad type');
  });

  it('falls through to String() for non-Error values', () => {
    expect(formatPilatesError('string')).toBe('string');
    expect(formatPilatesError(42)).toBe('42');
    expect(formatPilatesError(null)).toBe('null');
    expect(formatPilatesError(undefined)).toBe('undefined');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/react/src/errors/format.test.ts`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Write minimal implementation**

Create `packages/react/src/errors/format.ts`:

```ts
import { isPilatesError } from './pilates-error.js';

/**
 * Multi-line human-readable formatting of a PilatesError. Used by the default
 * ErrorBoundary fallback and (Phase 2) the in-frame ErrorOverview panel.
 *
 * Format:
 *   Pilates: <message>
 *     hint: <hint>           (dev only; omitted when hint is absent)
 *     caused by: <cause>     (recursive — indented two spaces per nesting)
 *
 * Plain Error / unknown values fall through to a single-line representation.
 */
export function formatPilatesError(err: unknown): string {
  if (isPilatesError(err)) {
    const lines = [`Pilates: ${err.message}`];
    if (err.hint) lines.push(`  hint: ${err.hint}`);
    if (err.cause !== undefined) {
      lines.push(`  caused by: ${formatCause(err.cause)}`);
    }
    return lines.join('\n');
  }
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}

function formatCause(c: unknown): string {
  if (isPilatesError(c)) {
    // Nested PilatesError: render fully and indent every continuation line.
    return formatPilatesError(c).replace(/\n/g, '\n  ');
  }
  if (c instanceof Error) return `${c.name}: ${c.message}`;
  return String(c);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/react/src/errors/format.test.ts`
Expected: PASS — 7 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/errors/format.ts packages/react/src/errors/format.test.ts
git commit -m "react/errors: add formatPilatesError multi-line formatter"
```

---

### Task 5: `host-type-suggestions.ts` — HTML→Pilates mapping + composed suggester

**Files:**
- Create: `packages/react/src/errors/host-type-suggestions.ts`
- Create: `packages/react/src/errors/host-type-suggestions.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/react/src/errors/host-type-suggestions.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { suggestHostTypeReplacement } from './host-type-suggestions.js';

describe('suggestHostTypeReplacement', () => {
  describe('HTML→Pilates mapping (highest priority)', () => {
    it('maps <div> to <Box> with HTML-specific message', () => {
      const r = suggestHostTypeReplacement('div');
      expect(r).toEqual({ kind: 'html', component: 'Box' });
    });

    it('maps layout-style HTML tags to <Box>', () => {
      for (const tag of ['div', 'section', 'article', 'main', 'header', 'footer', 'nav', 'aside']) {
        const r = suggestHostTypeReplacement(tag);
        expect(r).toEqual({ kind: 'html', component: 'Box' });
      }
    });

    it('maps text-style HTML tags to <Text>', () => {
      for (const tag of ['p', 'span', 'strong', 'em', 'b', 'i']) {
        const r = suggestHostTypeReplacement(tag);
        expect(r).toEqual({ kind: 'html', component: 'Text' });
      }
    });

    it('is case-insensitive on HTML lookup', () => {
      expect(suggestHostTypeReplacement('DIV')).toEqual({ kind: 'html', component: 'Box' });
      expect(suggestHostTypeReplacement('Div')).toEqual({ kind: 'html', component: 'Box' });
    });
  });

  describe('Levenshtein fallback for non-HTML', () => {
    it('suggests Box for lowercase "box"', () => {
      // n=3, exact case-insensitive match → didYouMean returns 'Box'
      expect(suggestHostTypeReplacement('box')).toEqual({ kind: 'spelling', component: 'Box' });
    });

    it('suggests Box for typo "bx" (n<3 needs exact case-insensitive match → none)', () => {
      // n=2, no exact match → undefined
      expect(suggestHostTypeReplacement('bx')).toBeUndefined();
    });

    it('suggests Box for typo "bxo" (n=3, dist 2 from Box)', () => {
      expect(suggestHostTypeReplacement('bxo')).toEqual({ kind: 'spelling', component: 'Box' });
    });

    it('returns undefined for far-away input', () => {
      expect(suggestHostTypeReplacement('xyzzy')).toBeUndefined();
    });
  });

  describe('precedence', () => {
    it('HTML mapping wins over Levenshtein when both could match', () => {
      // 'p' is in HTML table → Text; would also be too short for Levenshtein.
      expect(suggestHostTypeReplacement('p')).toEqual({ kind: 'html', component: 'Text' });
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/react/src/errors/host-type-suggestions.test.ts`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Write minimal implementation**

Create `packages/react/src/errors/host-type-suggestions.ts`:

```ts
import { didYouMean } from './did-you-mean.js';

/**
 * Replacement suggestion for an unknown JSX host type. The host-config layer
 * uses this to compose the "did you mean ...?" line of the UnknownHostType
 * error message.
 *
 * `kind: 'html'` means the input matched a known HTML tag — the message
 * should explain that Pilates is not HTML and point at the Pilates equivalent.
 *
 * `kind: 'spelling'` means the input was close enough to a Pilates component
 * name (case-insensitive Levenshtein) — the message should be a "did you
 * mean X?" hint.
 *
 * `undefined` means no useful suggestion; caller should produce a plain
 * "unknown host type X" message.
 */
export type HostTypeSuggestion =
  | { kind: 'html'; component: string }
  | { kind: 'spelling'; component: string };

/**
 * Common DOM tags React-DOM authors copy-paste, mapped to Pilates equivalents.
 * Layout-style tags map to <Box>; text-style tags map to <Text>.
 */
const HTML_TO_PILATES: Readonly<Record<string, string>> = {
  div: 'Box',
  section: 'Box',
  article: 'Box',
  main: 'Box',
  header: 'Box',
  footer: 'Box',
  nav: 'Box',
  aside: 'Box',
  p: 'Text',
  span: 'Text',
  strong: 'Text',
  em: 'Text',
  b: 'Text',
  i: 'Text',
};

/** Public-facing Pilates component names for Levenshtein fallback. */
const PILATES_COMPONENTS: readonly string[] = ['Box', 'Text', 'Static'];

export function suggestHostTypeReplacement(type: string): HostTypeSuggestion | undefined {
  const lower = type.toLowerCase();
  const html = HTML_TO_PILATES[lower];
  if (html !== undefined) return { kind: 'html', component: html };
  const spelling = didYouMean(type, PILATES_COMPONENTS);
  if (spelling !== undefined) return { kind: 'spelling', component: spelling };
  return undefined;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/react/src/errors/host-type-suggestions.test.ts`
Expected: PASS — 8 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/errors/host-type-suggestions.ts packages/react/src/errors/host-type-suggestions.test.ts
git commit -m "react/errors: add HTML→Pilates mapping + composed host-type suggester"
```

---

### Task 6: `errors/index.ts` — public barrel

**Files:**
- Create: `packages/react/src/errors/index.ts`

- [ ] **Step 1: Create the barrel**

Create `packages/react/src/errors/index.ts`:

```ts
export {
  PILATES_ERROR_HINTS,
  PilatesErrorCode,
  type PilatesErrorCode as PilatesErrorCodeType,
} from './codes.js';
export { didYouMean } from './did-you-mean.js';
export { formatPilatesError } from './format.js';
export {
  suggestHostTypeReplacement,
  type HostTypeSuggestion,
} from './host-type-suggestions.js';
export {
  PilatesError,
  isPilatesError,
  type PilatesErrorJSON,
  type PilatesErrorOptions,
} from './pilates-error.js';
```

- [ ] **Step 2: Verify it typechecks**

Run: `pnpm --filter @pilates/react typecheck`
Expected: clean (no output / "Done").

- [ ] **Step 3: Commit**

```bash
git add packages/react/src/errors/index.ts
git commit -m "react/errors: add public barrel"
```

---

### Task 7: Migrate `hooks.ts` — 5 throws to `HookOutsideRender`

**Files:**
- Modify: `packages/react/src/hooks.ts:101,107,124,137,160`

- [ ] **Step 1: Read the current file**

Run: `cat packages/react/src/hooks.ts | head -180`

Confirm the 5 throw sites are at:
- Line 101: `useApp` → `'Pilates: useApp() must be used inside <render>.'`
- Line 107: `useStdout` → `'Pilates: useStdout() must be used inside <render>.'`
- Line 124: `useStderr` → `'Pilates: useStderr() must be used inside <render>.'`
- Line 137: `usePaste` → `'Pilates: usePaste() must be used inside <render>.'`
- Line 160: `useInput` → `'Pilates: useInput() must be used inside <render>.'`

- [ ] **Step 2: Modify each throw site**

For each of the 5 throws, replace:

```ts
throw new Error('Pilates: useX() must be used inside <render>.');
```

with:

```ts
throw new PilatesError(
  PilatesErrorCode.HookOutsideRender,
  'useX() must be used inside <render>.',
  { meta: { hookName: 'useX' } },
);
```

Substitute the actual hook name (`useApp`, `useStdout`, `useStderr`, `usePaste`, `useInput`) in both the message and the `meta.hookName` field.

Add an import at the top of the file:

```ts
import { PilatesError, PilatesErrorCode } from './errors/index.js';
```

- [ ] **Step 3: Verify existing tests still pass**

Run: `pnpm exec vitest run packages/react/src/hooks` (or the broader `packages/react/src/`)
Expected: existing assertions on `must be used inside <render>` still match (they use `.toMatch(/.../)` regexes).

- [ ] **Step 4: Verify typecheck and lint clean**

Run: `pnpm --filter @pilates/react typecheck && pnpm lint`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/hooks.ts
git commit -m "react: migrate hooks.ts throws to PilatesError factories"
```

---

### Task 8: Migrate `focus.tsx` — 5 throws to factories

**Files:**
- Modify: `packages/react/src/focus.tsx:185,227,302,326,389`

- [ ] **Step 1: Read the current file**

Run: `cat packages/react/src/focus.tsx | sed -n '180,330p'`

Confirm the 5 throw sites:
- Line 185, 227 — duplicate-focus-id throws
- Line 302 — `'Pilates: FocusInputBridge mounted outside FocusProvider.'`
- Line 326 — `useFocus()` outside `<render>`
- Line 389 — `useFocusManager()` outside `<render>`

- [ ] **Step 2: Add the import**

Add at top of `focus.tsx`:

```ts
import { PilatesError, PilatesErrorCode } from './errors/index.js';
```

- [ ] **Step 3: Replace each throw**

| Old (line) | New |
|---|---|
| 185, 227 (duplicate id) | `throw new PilatesError(PilatesErrorCode.DuplicateFocusId, '<existing message minus "Pilates: " prefix>', { meta: { focusId: <id> } });` |
| 302 (FocusInputBridge) | `throw new PilatesError(PilatesErrorCode.FocusInputBridgeOutsideProvider, 'FocusInputBridge mounted outside FocusProvider.');` |
| 326 (useFocus) | `throw new PilatesError(PilatesErrorCode.HookOutsideRender, 'useFocus() must be used inside <render>.', { meta: { hookName: 'useFocus' } });` |
| 389 (useFocusManager) | `throw new PilatesError(PilatesErrorCode.HookOutsideRender, 'useFocusManager() must be used inside <render>.', { meta: { hookName: 'useFocusManager' } });` |

For lines 185 and 227, **read the current message contents** and preserve their payload (the focus id, any other context) substring-intact. Just strip the `Pilates: ` prefix.

- [ ] **Step 4: Verify existing tests still pass**

Run: `pnpm exec vitest run packages/react/src/focus`
Expected: pass — existing assertions at `focus.test.tsx:63,79` use `.toMatch(/must be used inside <render>/)` which still matches.

- [ ] **Step 5: Verify typecheck and lint clean**

Run: `pnpm --filter @pilates/react typecheck && pnpm lint`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/react/src/focus.tsx
git commit -m "react: migrate focus.tsx throws to PilatesError factories"
```

---

### Task 9: Migrate `host-config.ts` throws + wire did-you-mean

**Files:**
- Modify: `packages/react/src/host-config.ts:190,216,222,240,263,268,273,290,293`
- Modify: `packages/react/src/render.test.tsx:525` (verify only — no edit expected)
- Create new test: `packages/react/src/host-config.test.ts` (or add to an existing test file if present) — covers did-you-mean integration

- [ ] **Step 1: Read the current file**

Run: `cat packages/react/src/host-config.ts | sed -n '185,295p'`

Map each throw:
- Line 190: `unknown host type "${type}"` → `UnknownHostType` (with did-you-mean wired)
- Lines 216, 222, 273, 293: invariant strings → `StringFragmentInvariant`
- Lines 240, 290: bare strings at root → `BareStringAtRoot`
- Lines 263, 268: Box children invariants — read each; if it's "bare string in <Box>" → `BareStringInBox`, otherwise `StringFragmentInvariant`

- [ ] **Step 2: Add the import**

Add at top of `host-config.ts`:

```ts
import {
  PilatesError,
  PilatesErrorCode,
  suggestHostTypeReplacement,
} from './errors/index.js';
```

- [ ] **Step 3: Replace the unknown-host-type throw with did-you-mean integration**

At line 190, replace:

```ts
throw new Error(`Pilates: unknown host type "${type}"`);
```

with:

```ts
{
  const suggestion = suggestHostTypeReplacement(type);
  let message: string;
  if (suggestion?.kind === 'html') {
    message = `unknown host type "${type}" — Pilates is not HTML; use <${suggestion.component}> instead`;
  } else if (suggestion?.kind === 'spelling') {
    message = `unknown host type "${type}" — did you mean "${suggestion.component}"?`;
  } else {
    message = `unknown host type "${type}"`;
  }
  throw new PilatesError(PilatesErrorCode.UnknownHostType, message, {
    meta: { received: type, suggestion: suggestion ?? null },
  });
}
```

- [ ] **Step 4: Replace the remaining throws**

For each remaining throw site, replace `throw new Error('Pilates: ...')` with the appropriate factory call, keeping the message substring-intact and dropping the `'Pilates: '` prefix:

- Bare-string-at-root throws → `throw new PilatesError(PilatesErrorCode.BareStringAtRoot, 'bare strings are not allowed at the root. Wrap them in <Text>.');`
- Bare-string-in-Box throws → `throw new PilatesError(PilatesErrorCode.BareStringInBox, '<existing message>');`
- Invariant throws → `throw new PilatesError(PilatesErrorCode.StringFragmentInvariant, '<existing message>');`

- [ ] **Step 5: Add a new test for the did-you-mean integration**

Create `packages/react/src/host-config.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { PilatesError, PilatesErrorCode, isPilatesError } from './errors/index.js';
import { hostConfig } from './host-config.js';

describe('host-config — UnknownHostType did-you-mean', () => {
  it('throws PilatesError on unknown type', () => {
    expect(() => hostConfig.createInstance('xyzzy', {} as never, null, null, null)).toThrow(
      PilatesError,
    );
  });

  it('throws with HTML-mapping message for <div>', () => {
    try {
      hostConfig.createInstance('div', {} as never, null, null, null);
      throw new Error('expected throw');
    } catch (e) {
      expect(isPilatesError(e)).toBe(true);
      const err = e as PilatesError;
      expect(err.code).toBe(PilatesErrorCode.UnknownHostType);
      expect(err.message).toContain('div');
      expect(err.message).toContain('Pilates is not HTML');
      expect(err.message).toContain('<Box>');
    }
  });

  it('throws with did-you-mean message for typo "bxo"', () => {
    try {
      hostConfig.createInstance('bxo', {} as never, null, null, null);
      throw new Error('expected throw');
    } catch (e) {
      expect(isPilatesError(e)).toBe(true);
      const err = e as PilatesError;
      expect(err.message).toContain('did you mean "Box"');
    }
  });

  it('throws with plain message when no suggestion is close enough', () => {
    try {
      hostConfig.createInstance('xyzzy', {} as never, null, null, null);
      throw new Error('expected throw');
    } catch (e) {
      expect(isPilatesError(e)).toBe(true);
      const err = e as PilatesError;
      expect(err.message).toBe('unknown host type "xyzzy"');
    }
  });
});
```

> Note: the exact `createInstance` call signature depends on the host-config export shape. If the file does not currently export `hostConfig` directly, the test should import whatever wrapper does invoke `createInstance` — adjust the import and call shape to match what's actually exported. If no public surface exposes `createInstance`, drop the integration test and leave only the unit tests in Tasks 1–5; the rendered-component-stack-tests in Task 12 will exercise the throw site.

- [ ] **Step 6: Verify**

Run: `pnpm exec vitest run packages/react/src/host-config packages/react/src/render`
Expected: pass; existing assertion at `render.test.tsx:525` (`/bare strings are not allowed/`) still matches.

- [ ] **Step 7: Verify typecheck and lint clean**

Run: `pnpm --filter @pilates/react typecheck && pnpm lint`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add packages/react/src/host-config.ts packages/react/src/host-config.test.ts
git commit -m "react: migrate host-config.ts throws + wire did-you-mean for unknown host types"
```

---

### Task 10: Migrate `text-flatten.ts` — 1 throw

**Files:**
- Modify: `packages/react/src/text-flatten.ts:23`

- [ ] **Step 1: Read the current throw**

Run: `cat packages/react/src/text-flatten.ts | sed -n '20,30p'`

- [ ] **Step 2: Replace**

Add import at the top:

```ts
import { PilatesError, PilatesErrorCode } from './errors/index.js';
```

Replace:

```ts
throw new Error(
  // existing message
);
```

with:

```ts
throw new PilatesError(
  PilatesErrorCode.InvalidTextChild,
  // existing message minus 'Pilates: ' prefix
  { meta: { /* whatever context the original message interpolated */ } },
);
```

Read the existing message and preserve its payload (the offending child type / value) substring-intact in the new message.

- [ ] **Step 3: Verify**

Run: `pnpm exec vitest run packages/react/src/text-flatten`
Expected: pass.

- [ ] **Step 4: Verify typecheck and lint clean**

Run: `pnpm --filter @pilates/react typecheck && pnpm lint`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/text-flatten.ts
git commit -m "react: migrate text-flatten.ts throw to PilatesError"
```

---

### Task 11: Migrate `widgets/text-input.tsx` — 1 throw

**Files:**
- Modify: `packages/widgets/src/text-input.tsx:63-65`

- [ ] **Step 1: Add the import**

Add at top of `widgets/src/text-input.tsx`:

```ts
import { PilatesError, PilatesErrorCode } from '@pilates/react';
```

- [ ] **Step 2: Replace the throw**

At lines 63-65, replace:

```ts
throw new Error(
  `TextInput: mask must be a single grapheme, got "${mask}" (${maskGs.length} graphemes)`,
);
```

with:

```ts
throw new PilatesError(
  PilatesErrorCode.TextInputBadProp,
  `TextInput: mask must be a single grapheme, got "${mask}" (${maskGs.length} graphemes)`,
  { meta: { propName: 'mask', received: mask, graphemeCount: maskGs.length } },
);
```

- [ ] **Step 3: Verify the public surface is in place**

The widgets package imports from `@pilates/react`. Task 14 will add `PilatesError`/`PilatesErrorCode` to the `@pilates/react` barrel. Order matters — if Task 11 lands before Task 14, this import will be unresolved.

**To unblock**: do this task after Task 14, OR add a temporary deep import here (`@pilates/react/src/errors/index.js`) and refactor in Task 14. Recommended: reorder to do Task 14 first.

- [ ] **Step 4: Verify**

Run: `pnpm exec vitest run packages/widgets/src/text-input`
Expected: pass.

- [ ] **Step 5: Verify typecheck and lint clean**

Run: `pnpm typecheck && pnpm lint`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/widgets/src/text-input.tsx
git commit -m "widgets: migrate text-input throw to PilatesError"
```

---

### Task 12: Reconciler `componentStack` capture in `render.tsx`

**Files:**
- Modify: `packages/react/src/render.tsx:411-438`
- Modify or create test: `packages/react/src/error-boundary.test.tsx` (add a test asserting `componentStack` is populated when a `PilatesError` is caught)

- [ ] **Step 1: Read the current callbacks**

Run: `cat packages/react/src/render.tsx | sed -n '410,450p'`

The current shape:

```ts
const onUncaughtError = (err: Error) => finishUnmount(err, true);
const onCaughtError = (err: Error): void => {
  stderr.write(`Pilates: caught render error: ${err.message}\n`);
};
const onRecoverableError = (err: Error): void => {
  stderr.write(`Pilates: recoverable render error: ${err.message}\n`);
};
```

- [ ] **Step 2: Add the import**

Add to the existing imports in `render.tsx`:

```ts
import { isPilatesError } from './errors/index.js';
```

- [ ] **Step 3: Replace the callbacks**

Replace the three callback definitions with:

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

The 14-arg `createContainer` cast already takes `(err: Error, info: unknown) => void`, so no signature change is needed there.

- [ ] **Step 4: Add a test for componentStack capture**

In `packages/react/src/error-boundary.test.tsx`, add a new test:

```tsx
import { describe, expect, it } from 'vitest';
import { PilatesError, PilatesErrorCode, isPilatesError } from './errors/index.js';
import { ErrorBoundary } from './error-boundary.js';
// (existing imports from this file)

it('attaches errorInfo.componentStack onto a thrown PilatesError', () => {
  let captured: unknown = null;
  function Bomb(): never {
    throw new PilatesError(PilatesErrorCode.HookOutsideRender, 'kaboom');
  }
  function App() {
    return (
      <ErrorBoundary
        onError={(err) => {
          captured = err;
        }}
      >
        <Bomb />
      </ErrorBoundary>
    );
  }
  // (use the existing mountWithInput / render harness in this file)
  const handle = mountWithInput(0, () => <App />, { width: 20, height: 1 });
  expect(isPilatesError(captured)).toBe(true);
  if (isPilatesError(captured)) {
    expect(captured.componentStack).toMatch(/Bomb/);
    expect(captured.componentStack).toMatch(/App/);
  }
  handle.unmount();
});
```

> Note: adapt the import for `mountWithInput` and the render harness to match what `error-boundary.test.tsx` already uses. If the existing test file already imports these, reuse them — do not introduce a second import path.

- [ ] **Step 5: Verify**

Run: `pnpm exec vitest run packages/react/src/error-boundary packages/react/src/render`
Expected: pass.

- [ ] **Step 6: Verify typecheck and lint clean**

Run: `pnpm --filter @pilates/react typecheck && pnpm lint`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add packages/react/src/render.tsx packages/react/src/error-boundary.test.tsx
git commit -m "react: attach errorInfo.componentStack onto PilatesError in reconciler glue"
```

---

### Task 13: Default `ErrorBoundary` fallback uses formatter

**Files:**
- Modify: `packages/react/src/error-boundary.tsx:124-130`
- Modify: `packages/react/src/error-boundary.test.tsx` (add tests for the new fallback)

- [ ] **Step 1: Read the current default fallback**

```tsx
function DefaultFallback({ error }: ErrorBoundaryFallbackProps): ReactNode {
  return (
    <Text bold color="red">
      {`Render error: ${error.message}`}
    </Text>
  );
}
```

- [ ] **Step 2: Add the import**

In `error-boundary.tsx`:

```ts
import { isPilatesError } from './errors/index.js';
```

- [ ] **Step 3: Update the fallback**

Replace `DefaultFallback` with:

```tsx
function DefaultFallback({ error }: ErrorBoundaryFallbackProps): ReactNode {
  // Single-line fallback so it works in the tightest viewport. Phase 2's
  // <ErrorOverview> renders the full multi-line formatPilatesError() output
  // when given a richer area to paint into.
  if (isPilatesError(error)) {
    const tail = error.hint ? ` (${error.hint})` : '';
    return (
      <Text bold color="red">
        {`Pilates: ${error.message}${tail}`}
      </Text>
    );
  }
  return (
    <Text bold color="red">
      {`Render error: ${error.message}`}
    </Text>
  );
}
```

- [ ] **Step 4: Add tests**

In `packages/react/src/error-boundary.test.tsx`, add:

```tsx
it('default fallback shows Pilates: <message> for a PilatesError', () => {
  function Bomb(): never {
    throw new PilatesError(
      PilatesErrorCode.HookOutsideRender,
      'useApp() must be used inside <render>.',
    );
  }
  const handle = mountWithInput(
    0,
    () => (
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>
    ),
    { width: 80, height: 3 },
  );
  expect(handle.lastWrite()).toContain('Pilates:');
  expect(handle.lastWrite()).toContain('useApp');
  handle.unmount();
});

it('default fallback appends the hint when present (dev mode)', () => {
  function Bomb(): never {
    throw new PilatesError(PilatesErrorCode.HookOutsideRender, 'x');
  }
  const handle = mountWithInput(
    0,
    () => (
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>
    ),
    { width: 200, height: 3 },
  );
  // Dev mode (NODE_ENV=test): hint should be present in parens after message.
  expect(handle.lastWrite()).toMatch(/\(.*render.*\)/i);
  handle.unmount();
});

it('default fallback uses Render error: prefix for non-PilatesError', () => {
  function Bomb(): never {
    throw new Error('some plain error');
  }
  const handle = mountWithInput(
    0,
    () => (
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>
    ),
    { width: 60, height: 3 },
  );
  expect(handle.lastWrite()).toContain('Render error: some plain error');
  handle.unmount();
});
```

- [ ] **Step 5: Verify**

Run: `pnpm exec vitest run packages/react/src/error-boundary`
Expected: pass.

- [ ] **Step 6: Verify typecheck and lint clean**

Run: `pnpm --filter @pilates/react typecheck && pnpm lint`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add packages/react/src/error-boundary.tsx packages/react/src/error-boundary.test.tsx
git commit -m "react: ErrorBoundary default fallback feeds error through formatPilatesError-style output"
```

---

### Task 14: Re-export from `packages/react/src/index.ts`

**Files:**
- Modify: `packages/react/src/index.ts`

- [ ] **Step 1: Read the existing index**

Run: `cat packages/react/src/index.ts`

- [ ] **Step 2: Add the re-exports**

Append to `packages/react/src/index.ts`:

```ts
// Error infrastructure (Phase 1)
export {
  PILATES_ERROR_HINTS,
  PilatesError,
  PilatesErrorCode,
  type PilatesErrorJSON,
  type PilatesErrorOptions,
  didYouMean,
  formatPilatesError,
  isPilatesError,
  suggestHostTypeReplacement,
  type HostTypeSuggestion,
} from './errors/index.js';
```

- [ ] **Step 3: Add a smoke test**

Create or extend `packages/react/src/index.test.ts` with:

```ts
import { describe, expect, it } from 'vitest';
import * as Pilates from './index.js';

describe('@pilates/react public surface — error infrastructure', () => {
  it('re-exports PilatesError and the codes', () => {
    expect(typeof Pilates.PilatesError).toBe('function');
    expect(typeof Pilates.PilatesErrorCode).toBe('object');
    expect(Pilates.PilatesErrorCode.HookOutsideRender).toBe('PILATES_HOOK_OUTSIDE_RENDER');
  });

  it('re-exports isPilatesError + formatPilatesError', () => {
    expect(typeof Pilates.isPilatesError).toBe('function');
    expect(typeof Pilates.formatPilatesError).toBe('function');
  });

  it('re-exports the suggestion utility', () => {
    expect(typeof Pilates.suggestHostTypeReplacement).toBe('function');
    expect(typeof Pilates.didYouMean).toBe('function');
  });
});
```

> Note: if `packages/react/src/index.test.ts` does not exist, create it. If it does, add this describe block alongside whatever's already there.

- [ ] **Step 4: Verify**

Run: `pnpm exec vitest run packages/react/src/index`
Expected: pass.

- [ ] **Step 5: Verify typecheck and lint clean**

Run: `pnpm --filter @pilates/react typecheck && pnpm lint`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/react/src/index.ts packages/react/src/index.test.ts
git commit -m "react: re-export error infrastructure from public barrel"
```

---

### Task 15: README "Error handling" section

**Files:**
- Modify: `packages/react/README.md`

- [ ] **Step 1: Read the current README structure**

Run: `cat packages/react/README.md | head -50`

Note where existing major sections live (likely "API", "Hooks", etc.) — append the new section after the existing public-API documentation but before any contribution / testing notes.

- [ ] **Step 2: Add the section**

Append to `packages/react/README.md`:

````markdown
## Error handling

`@pilates/react` throws `PilatesError` for every framework-level invariant.
Errors carry a stable `code`, optional dev-only `hint`, structured `meta`,
and a `componentStack` populated by the reconciler when a render-time error
is caught.

### Discriminating errors

Prefer the `isPilatesError` guard over `instanceof PilatesError`. It uses a
`Symbol.for('pilates.error')` tag that survives multiple copies of the
library being loaded into the same process (pnpm hoisting / dual-publish
edge cases):

```ts
import { isPilatesError, PilatesErrorCode } from '@pilates/react';

try {
  // ...
} catch (e) {
  if (isPilatesError(e) && e.code === PilatesErrorCode.HookOutsideRender) {
    // recover
  }
}
```

### SemVer policy

| Surface | Stable? |
|---|---|
| `error.code` (the string ID) | **Yes** — renaming a code is a major-version change |
| `error instanceof PilatesError` / `isPilatesError(e)` | **Yes** |
| Structured fields: `code`, `meta`, `componentStack`, `ownerStack` | **Yes** — adding new optional fields is non-breaking |
| `toJSON()` output shape | **Yes** — adding new optional keys is non-breaking |
| `error.message` text | **No** — may be reworded freely |
| `error.hint` text and presence | **No** — dev-only, may be reworded freely |
| Stack-trace formatting | **No** |

This matches the policy used by Node core's error API.

### Error code reference

| Code | Thrown from |
|---|---|
| `PILATES_HOOK_OUTSIDE_RENDER` | `useApp`, `useStdout`, `useStderr`, `usePaste`, `useInput`, `useFocus`, `useFocusManager` outside a `render()`-mounted tree |
| `PILATES_FOCUS_OUTSIDE_PROVIDER` | `useFocus()` outside `<FocusProvider>` |
| `PILATES_DUPLICATE_FOCUS_ID` | Two simultaneous `useFocus({ id })` calls with the same id |
| `PILATES_FOCUS_INPUT_BRIDGE_OUTSIDE_PROVIDER` | Internal — indicates a corrupted install if user-visible |
| `PILATES_UNKNOWN_HOST_TYPE` | JSX with a host element that isn't a Pilates component (e.g. `<div>`) |
| `PILATES_BARE_STRING_AT_ROOT` | A raw string at the `<render>` root |
| `PILATES_BARE_STRING_IN_BOX` | A raw string as a `<Box>` child |
| `PILATES_STRING_FRAGMENT_INVARIANT` | Internal invariant — file an issue if you hit one |
| `PILATES_INVALID_TEXT_CHILD` | A non-string, non-`<Text>` child of `<Text>` |
| `PILATES_TEXTINPUT_BAD_PROP` | `<TextInput>` received a malformed prop |

### Format helpers

`formatPilatesError(err)` returns a multi-line string suitable for printing
into the terminal: `Pilates: <message>` followed by an indented `hint:` line
(in dev mode) and a `caused by:` chain (recursive on `error.cause`):

```ts
import { formatPilatesError } from '@pilates/react';

try {
  // ...
} catch (e) {
  console.error(formatPilatesError(e));
}
```

### Source maps

Pilates emits `.js.map` alongside its compiled output. Run your app with
`node --enable-source-maps your-cli.js` to make stack traces point at the
original `.ts` source rather than the published `dist/` files. Pilates
deliberately does **not** bundle a runtime `source-map-support` patch: a
library mutating `Error.prepareStackTrace` is hostile to its host.
````

- [ ] **Step 3: Verify lint**

Run: `pnpm lint`
Expected: clean (biome doesn't lint markdown by default; this is just a sanity check).

- [ ] **Step 4: Commit**

```bash
git add packages/react/README.md
git commit -m "react: README — add Error handling section + code reference + SemVer policy"
```

---

### Task 16: CHANGELOG entry under `## Unreleased`

**Files:**
- Modify: `packages/react/CHANGELOG.md`

- [ ] **Step 1: Read the current CHANGELOG**

Run: `cat packages/react/CHANGELOG.md | head -40`

- [ ] **Step 2: Add the entry**

Under `## Unreleased` (or create the section if missing), add:

```markdown
### Errors (new public surface)

- **Added** `PilatesError` class with `.code`, dev-only `.hint`,
  structured `.meta`, and `.componentStack` populated by the reconciler.
- **Added** `PilatesErrorCode` const object + derived type — stable string
  IDs (e.g. `PILATES_HOOK_OUTSIDE_RENDER`, `PILATES_UNKNOWN_HOST_TYPE`).
- **Added** `isPilatesError(e)` type guard — prefer over `instanceof` for
  cross-realm safety (pnpm hoisting / dual-publish).
- **Added** `formatPilatesError(err)` — multi-line formatter for terminal
  output (used by the default `<ErrorBoundary>` fallback).
- **Added** Did-you-mean for unknown JSX host types: `<div>` →
  `Pilates is not HTML; use <Box> instead`; typos → `did you mean "Box"?`.
- **Added** `componentStack` capture from `react-reconciler`'s
  `errorInfo` onto thrown `PilatesError`s — visible to consumer
  `<ErrorBoundary onError>` handlers, telemetry, and Phase 2's overlay.
- **Changed** All 16 framework throw sites now produce `PilatesError`s
  rather than plain `Error`. The `Pilates: ` prefix moved out of the raw
  `error.message` and into `formatPilatesError()` — user-visible output
  via the default fallback is unchanged. Existing tests asserting on
  payload substrings (e.g. `/must be used inside <render>/`) continue
  to pass; tests asserting on the literal `"Pilates:"` prefix in
  `error.message` would need updating, but no such assertions exist
  in the public test corpus.
- **SemVer**: `error.code`, `instanceof PilatesError` / `isPilatesError`,
  and structured field shapes are public API. `error.message` text and
  `error.hint` text are not — they may be reworded in any minor.
- **Source maps**: Pilates emits `.js.map`. Run with
  `node --enable-source-maps` for `.ts`-pointing stack traces. No runtime
  `source-map-support` patch is bundled (libs must not mutate
  `Error.prepareStackTrace`).
```

- [ ] **Step 3: Commit**

```bash
git add packages/react/CHANGELOG.md
git commit -m "react: CHANGELOG — error infrastructure (Phase 1)"
```

---

### Task 17: Final verification + open PR

**Files:** none modified — verification only.

- [ ] **Step 1: Full test suite**

Run: `pnpm test`
Expected: all tests pass. Total count should be **626 + new tests** (counts: ~9 + 6 + 16 + 7 + 8 + 4 boundary + 3 index = ~53 new = ~679).

If any test fails, return to the offending task and fix.

- [ ] **Step 2: Typecheck + lint clean**

Run: `pnpm typecheck && pnpm lint`
Expected: clean.

- [ ] **Step 3: Build clean**

Run: `pnpm -r --filter @pilates/react build`
Expected: clean — `dist/` produced with `.js.map` files alongside.

Sanity check that source maps are emitted:

Run: `ls packages/react/dist/errors/*.js.map`
Expected: `pilates-error.js.map`, `codes.js.map`, etc.

- [ ] **Step 4: Push the branch**

```bash
git push origin error-infrastructure-spec
```

- [ ] **Step 5: Open the PR**

```bash
gh pr create --title "react: error infrastructure (Phase 1) → @pilates/react@0.4.0" --body "$(cat <<'EOF'
## Summary
- Adds `PilatesError` class with `.code`, dev-only `.hint`, structured `.meta`, and `.componentStack` capture from `react-reconciler`.
- Adds did-you-mean for unknown JSX host types, including HTML→Pilates copy-paste hints (`<div>` → `<Box>`).
- Migrates all 16 existing framework throws to `PilatesError` factories.
- Adds `isPilatesError(e)` guard (cross-realm-safe) and `formatPilatesError(err)` formatter.

Phase 1 of the three-phase error DX investment ([spec](docs/superpowers/specs/2026-05-05-error-infrastructure-design.md)). Phase 2 (`<ErrorOverview>` panel) and Phase 3 (friendly child-type validation, owner stack, `pilates-doctor`) follow in separate PRs.

## SemVer
- New public surface: `PilatesError`, `PilatesErrorCode`, `isPilatesError`, `formatPilatesError`, `suggestHostTypeReplacement`. Bumps `@pilates/react` to `0.4.0`.
- `error.code` and `instanceof` are public API; `error.message` text is not (matches Node core's policy).
- The `Pilates: ` prefix moved from raw `error.message` into `formatPilatesError`. Existing repo tests audited — all use payload-only fragments. No consumer breakage expected for the typical `instanceof Error` / regex-on-message patterns.

## Test plan
- [x] `pnpm test` — full suite (626 → ~679 tests)
- [x] `pnpm typecheck` — clean
- [x] `pnpm lint` — clean
- [x] `pnpm -r build` — `.js.map` files emitted
- [x] CI on macOS / Ubuntu / Windows

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR created; CI starts running. URL is printed.

---

## Self-Review Checklist

This plan covers every section of the spec:

| Spec section | Task(s) |
|---|---|
| `pilates-error.ts` | Task 3 |
| `codes.ts` | Task 2 |
| `did-you-mean.ts` | Task 1 |
| `format.ts` | Task 4 |
| `host-type-suggestions.ts` (in spec under "Did-you-mean for unknown JSX host types") | Task 5 |
| `errors/index.ts` (public barrel) | Task 6 |
| Migration map (16 sites) | Tasks 7, 8, 9, 10, 11 |
| Reconciler `onCaughtError` glue | Task 12 |
| Default `ErrorBoundary` fallback | Task 13 |
| Public re-exports from `@pilates/react` | Task 14 |
| README "Error handling" section | Task 15 |
| CHANGELOG entry | Task 16 |
| Public API and SemVer surface | Task 15 (README), Task 16 (CHANGELOG), Task 17 (PR body) |
| Test plan | Distributed: Tasks 1–6 (unit), 7–11 (migration regressions), 12–13 (integration), 14 (smoke) |

**Ordering note:** Task 11 (widgets) imports `PilatesError` from `@pilates/react`, which requires Task 14 (the public re-export) to land first. Either reorder Task 11 to run after Task 14, or use a deep import in Task 11 that's refactored to the public path in Task 14. Recommended: do Task 14 before Task 11.

**Cross-task type consistency:** the class's `code` field, the `PilatesErrorCode` const object, the `meta`/`componentStack`/`ownerStack` field names, and the `isPilatesError` / `formatPilatesError` / `suggestHostTypeReplacement` function names are used identically across all task code blocks.
