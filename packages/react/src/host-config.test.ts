import { describe, expect, it } from 'vitest';
import { PilatesErrorCode, isPilatesError } from './errors/index.js';
import { buildHostConfig } from './host-config.js';

/**
 * Integration tests for the UnknownHostType throw site in host-config.ts.
 * Reaches the throw via the public `buildHostConfig()` surface — the host
 * config's `createInstance` is the same function the reconciler invokes for
 * every JSX intrinsic, so calling it with an unknown type exercises the same
 * code path the reconciler would on a bad <foo> element.
 */
describe('host-config — createInstance unknown host type', () => {
  // react-reconciler's createInstance signature is
  // `(type, props, container, hostContext, fiber)` — the host-config
  // implementation only consults `type` and `props`, so we pass dummies for
  // the rest. Cast to bypass the strict reconciler types in the test.
  const createInstance = (type: string): unknown => {
    const cfg = buildHostConfig();
    type CreateInstance = (
      type: string,
      props: Record<string, unknown>,
      container: unknown,
      hostContext: unknown,
      fiber: unknown,
    ) => unknown;
    const fn = cfg.createInstance as unknown as CreateInstance;
    return fn(type, {}, {}, {}, null);
  };

  it('throws PilatesError with code UnknownHostType for an unknown type', () => {
    let caught: unknown;
    try {
      createInstance('unknownThing');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(isPilatesError(caught)).toBe(true);
    if (isPilatesError(caught)) {
      expect(caught.code).toBe(PilatesErrorCode.UnknownHostType);
    }
  });

  it('produces an HTML-aware message for "div"', () => {
    expect(() => createInstance('div')).toThrow(/div/);
    expect(() => createInstance('div')).toThrow(/Pilates is not HTML/);
    expect(() => createInstance('div')).toThrow(/<Box>/);
  });

  it('produces a did-you-mean message for typo "bxo"', () => {
    expect(() => createInstance('bxo')).toThrow(/did you mean "Box"/);
  });

  it('produces a plain message with no suggestion line for "xyzzy"', () => {
    let caught: unknown;
    try {
      createInstance('xyzzy');
    } catch (e) {
      caught = e;
    }
    expect(isPilatesError(caught)).toBe(true);
    if (isPilatesError(caught)) {
      expect(caught.message).toBe('unknown host type "xyzzy"');
    }
  });

  it('attaches received type and suggestion to meta', () => {
    let caught: unknown;
    try {
      createInstance('div');
    } catch (e) {
      caught = e;
    }
    expect(isPilatesError(caught)).toBe(true);
    if (isPilatesError(caught)) {
      expect(caught.meta).toEqual({
        received: 'div',
        suggestion: { kind: 'html', component: 'Box' },
      });
    }
  });
});
