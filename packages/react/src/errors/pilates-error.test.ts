import { describe, expect, it } from 'vitest';
import { PilatesErrorCode } from './codes.js';
import { PilatesError, isPilatesError } from './pilates-error.js';

describe('PilatesError — constructor', () => {
  it('sets code, name, and message', () => {
    const e = new PilatesError(
      PilatesErrorCode.HookOutsideRender,
      'useApp() must be used inside <render>',
    );
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
    const e = new PilatesError(PilatesErrorCode.UnknownHostType, 'wrap', {
      cause: 'literal-string-cause',
    });
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
    const tag = Symbol.for('pilates.error');
    const fake: Record<symbol, unknown> = { [tag]: true };
    expect(isPilatesError(fake)).toBe(true);
  });
});
