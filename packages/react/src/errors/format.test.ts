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

  it('renders [Circular] when a PilatesError is its own cause', () => {
    const e = new PilatesError(PilatesErrorCode.HookOutsideRender, 'self-ref');
    e.cause = e;
    const out = formatPilatesError(e);
    expect(out).toContain('Pilates: self-ref');
    expect(out).toContain('[Circular]');
  });

  it('renders [Circular] for a longer cycle (A → B → A)', () => {
    const a = new PilatesError(PilatesErrorCode.HookOutsideRender, 'a');
    const b = new PilatesError(PilatesErrorCode.UnknownHostType, 'b');
    a.cause = b;
    b.cause = a;
    const out = formatPilatesError(a);
    expect(out).toContain('Pilates: a');
    expect(out).toContain('Pilates: b');
    expect(out).toContain('[Circular]');
  });
});
