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
  readonly meta: Record<string, unknown> | undefined;
  /** Mutable: the reconciler glue writes here in onCaughtError. */
  componentStack: string | undefined;
  /** Mutable: reserved for Phase 3 captureOwnerStack() integration. */
  ownerStack: string | undefined;
  /** Dev-only. Empty in prod (the hint table tree-shakes via NODE_ENV). */
  readonly hint: string | undefined;
  readonly [PILATES_ERROR_TAG] = true;

  constructor(code: PilatesErrorCode, message: string, options: PilatesErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.code = code;
    this.meta = options.meta;
    this.componentStack = options.componentStack;
    this.ownerStack = options.ownerStack;
    this.hint = process.env.NODE_ENV !== 'production' ? PILATES_ERROR_HINTS[code] : undefined;
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
