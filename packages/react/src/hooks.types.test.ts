/**
 * Type-level tests for @pilates/react public hook APIs. Runs alongside
 * runtime tests; the assertions are compile-time (no runtime behavior).
 *
 * Sanity check: removing a generic from useInput / useApp / useStdout
 * should make these tests fail under `pnpm typecheck`.
 */

import { describe, expectTypeOf, it } from 'vitest';
import type { AppHookValue, KeyEvent, KeyName, StderrHookValue, StdoutHookValue } from './hooks.js';
import { useApp, useInput, useStderr, useStdout } from './hooks.js';
import { render } from './render.js';
import type { RenderInstance } from './render.js';

describe('hook return types', () => {
  it('useApp returns { exit: (error?: Error) => void }', () => {
    expectTypeOf(useApp).returns.toEqualTypeOf<AppHookValue>();
    expectTypeOf<AppHookValue['exit']>().toEqualTypeOf<(error?: Error) => void>();
  });

  it('useStdout returns columns / rows / write / stdout', () => {
    expectTypeOf(useStdout).returns.toEqualTypeOf<StdoutHookValue>();
    expectTypeOf<StdoutHookValue['columns']>().toBeNumber();
    expectTypeOf<StdoutHookValue['rows']>().toBeNumber();
  });

  it('useStderr returns stderr / write', () => {
    expectTypeOf(useStderr).returns.toEqualTypeOf<StderrHookValue>();
    expectTypeOf<StderrHookValue['write']>().toEqualTypeOf<(s: string) => boolean>();
  });
});

describe('useInput callback shape', () => {
  it('handler receives a KeyEvent', () => {
    expectTypeOf(useInput).parameter(0).toEqualTypeOf<(event: KeyEvent) => void>();
  });

  it('KeyEvent has discriminated optional name + ch + modifier flags', () => {
    expectTypeOf<KeyEvent['name']>().toEqualTypeOf<KeyName | undefined>();
    expectTypeOf<KeyEvent['ch']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<KeyEvent['ctrl']>().toBeBoolean();
    expectTypeOf<KeyEvent['alt']>().toBeBoolean();
    expectTypeOf<KeyEvent['shift']>().toBeBoolean();
    expectTypeOf<KeyEvent['sequence']>().toBeString();
  });
});

describe('render() return type', () => {
  it('render returns a RenderInstance with unmount + waitUntilExit', () => {
    expectTypeOf(render).returns.toEqualTypeOf<RenderInstance>();
    expectTypeOf<RenderInstance['unmount']>().toEqualTypeOf<() => void>();
    expectTypeOf<RenderInstance['waitUntilExit']>().toEqualTypeOf<() => Promise<void>>();
  });
});
