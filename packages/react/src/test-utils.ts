import { EventEmitter } from 'node:events';
import type { ContainerNode } from '@pilates/render';
import { type ReactElement, act, createElement, useState } from 'react';
import ReactReconciler from 'react-reconciler';
import { LegacyRoot } from 'react-reconciler/constants.js';
import {
  AppContext,
  type AppHookValue,
  type KeyEvent,
  type KeyName,
  StderrContext,
  type StderrHookValue,
  StdoutContext,
  type StdoutHookValue,
} from './hooks.js';
import { buildHostConfig } from './host-config.js';
import type { RootContainer } from './reconciler.js';
import { StdinProvider } from './render.js';

export interface RenderToStringOptions {
  width: number;
  height: number;
}

/**
 * react-reconciler@0.31 split the legacy synchronous flush into
 * `updateContainerSync` + `flushSyncWork`. The @types/react-reconciler
 * @0.28.9 surface doesn't list these yet, so we cast at the boundary.
 */
interface SyncReconciler {
  updateContainerSync(
    element: unknown,
    container: unknown,
    parent: unknown,
    callback: (() => void) | null,
  ): void;
  flushSyncWork(): void;
  /** Flush deferred passive effects (useEffect callbacks). */
  flushPassiveEffects(): boolean;
}

function asSync(reconciler: ReturnType<typeof ReactReconciler>): SyncReconciler {
  return reconciler as unknown as SyncReconciler;
}

/**
 * Mount a React element with a fake stdout, run one synchronous commit,
 * and return the rendered Frame's `toString()` output.
 *
 * Returns plain-text-with-SGR frame output (rows joined by `\n`, NOT the
 * ANSI cursor-positioning deltas that production render() would write to
 * stdout). This keeps static-tree tests assertable with a simple SGR
 * strip, and matches `@pilates/render`'s own test conventions
 * (`toPlainString()`).
 *
 * Public — exported from `@pilates/react/test-utils`. Intended for use in
 * test environments only.
 */
export function renderToString(element: ReactElement, options: RenderToStringOptions): string {
  const rootNode: ContainerNode = {
    width: options.width,
    height: options.height,
    children: [],
  };
  const container: RootContainer = {
    root: rootNode,
    prevFrame: null,
    onFlush: () => {
      /* drop ANSI deltas — tests read frames, not bytes. */
    },
  };
  // Capture commit-phase errors (host-config validation throws) so the
  // caller sees them as a thrown exception, not a silently-dropped log.
  // Production render() routes the same callback through finishUnmount;
  // tests want the error to be observable synchronously.
  let captured: unknown = null;
  const reconciler = ReactReconciler(buildHostConfig());
  const containerHandle = reconciler.createContainer(
    container,
    LegacyRoot,
    null,
    false,
    null,
    'pilates',
    (err: Error) => {
      captured = err;
    },
    null,
  );
  const sync = asSync(reconciler);
  sync.updateContainerSync(element, containerHandle, null, null);
  sync.flushSyncWork();
  if (captured) throw captured;
  // Frame.toString() joins rows with `\n` but omits the trailing newline.
  // Tests treat rows as newline-terminated, so append one here.
  const out = container.prevFrame?.toString() ?? '';
  return out.length > 0 ? `${out}\n` : '';
}

export interface MountHandle<T> {
  /** Latest captured ANSI write (the most recent flush). */
  lastWrite(): string;
  /** All ANSI writes concatenated, in order. */
  allWrites(): string;
  setState(value: T): void;
  unmount(): void;
}

/**
 * Mount a parameterized element and return a handle that can drive
 * setState updates. Each setState produces a synchronous commit so the
 * test can read the resulting ANSI delta from `lastWrite()` /
 * `allWrites()`.
 *
 * Public — exported from `@pilates/react/test-utils`. Intended for use in
 * test environments only.
 */
export function mount<T>(
  initial: T,
  renderFn: (state: T) => ReactElement,
  options: RenderToStringOptions,
): MountHandle<T> {
  let setter: ((next: T) => void) | null = null;
  const writes: string[] = [];

  function Wrapper(props: { initial: T }) {
    const [state, setState] = useState(props.initial);
    setter = setState;
    return renderFn(state);
  }

  const rootNode: ContainerNode = {
    width: options.width,
    height: options.height,
    children: [],
  };
  const container: RootContainer = {
    root: rootNode,
    prevFrame: null,
    onFlush: (ansi) => writes.push(ansi),
  };
  const reconciler = ReactReconciler(buildHostConfig());
  const handle = reconciler.createContainer(
    container,
    LegacyRoot,
    null,
    false,
    null,
    'pilates',
    () => {},
    null,
  );
  const sync = asSync(reconciler);
  sync.updateContainerSync(createElement(Wrapper, { initial }), handle, null, null);
  sync.flushSyncWork();

  return {
    lastWrite: () => writes[writes.length - 1] ?? '',
    allWrites: () => writes.join(''),
    setState: (value) => {
      if (!setter) throw new Error('setter not captured');
      setter(value);
      sync.flushSyncWork();
    },
    unmount: () => {
      sync.updateContainerSync(null, handle, null, null);
      sync.flushSyncWork();
    },
  };
}

// ---------------------------------------------------------------------------
// FakeStdin — EventEmitter-backed stdin double for input testing
// ---------------------------------------------------------------------------

/**
 * EventEmitter-backed stdin double for use with {@link mountWithInput}.
 * Records `setRawMode` calls in `rawModeCalls` and `pause`/`resume` calls
 * in `flowCalls` so tests can assert on the lifecycle.
 */
export interface FakeStdin {
  readonly isTTY: true;
  /** History of setRawMode calls: true = enabled, false = disabled. */
  readonly rawModeCalls: boolean[];
  /** History of flow-control calls: 'pause' or 'resume', in order. */
  readonly flowCalls: ReadonlyArray<'pause' | 'resume'>;
  setRawMode(mode: boolean): this;
  resume(): this;
  pause(): this;
  on(event: string, listener: (...args: unknown[]) => void): this;
  off(event: string, listener: (...args: unknown[]) => void): this;
  once(event: string, listener: (...args: unknown[]) => void): this;
  removeListener(event: string, listener: (...args: unknown[]) => void): this;
  emit(event: string, ...args: unknown[]): boolean;
}

/**
 * Create a fake stdin double for use with {@link mountWithInput}.
 *
 * Public — exported from `@pilates/react/test-utils`. Intended for use in
 * test environments only.
 */
export function makeFakeStdin(): FakeStdin {
  const emitter = new EventEmitter();
  const rawModeCalls: boolean[] = [];
  const flowCalls: Array<'pause' | 'resume'> = [];

  const fake: FakeStdin = {
    isTTY: true,
    rawModeCalls,
    flowCalls,
    setRawMode(mode: boolean) {
      rawModeCalls.push(mode);
      return this;
    },
    resume() {
      flowCalls.push('resume');
      return this;
    },
    pause() {
      flowCalls.push('pause');
      return this;
    },
    on(event: string, listener: (...args: unknown[]) => void) {
      emitter.on(event, listener);
      return this;
    },
    off(event: string, listener: (...args: unknown[]) => void) {
      emitter.off(event, listener);
      return this;
    },
    once(event: string, listener: (...args: unknown[]) => void) {
      emitter.once(event, listener);
      return this;
    },
    removeListener(event: string, listener: (...args: unknown[]) => void) {
      emitter.removeListener(event, listener);
      return this;
    },
    emit(event: string, ...args: unknown[]) {
      return emitter.emit(event, ...args);
    },
  };

  return fake;
}

// ---------------------------------------------------------------------------
// eventToBytes — maps a partial KeyEvent to raw byte sequence
// ---------------------------------------------------------------------------

function eventToBytes(event: Partial<KeyEvent>): string {
  if (event.sequence) return event.sequence;
  if (event.name) {
    switch (event.name) {
      case 'enter':
        return '\r';
      case 'tab':
        return '\t';
      case 'backspace':
        return '\x7f';
      case 'escape':
        return '\x1b';
      case 'space':
        return ' ';
      case 'up':
        return event.ctrl
          ? '\x1b[1;5A'
          : event.alt
            ? '\x1b[1;3A'
            : event.shift
              ? '\x1b[1;2A'
              : '\x1b[A';
      case 'down':
        return event.ctrl
          ? '\x1b[1;5B'
          : event.alt
            ? '\x1b[1;3B'
            : event.shift
              ? '\x1b[1;2B'
              : '\x1b[B';
      case 'right':
        return event.ctrl
          ? '\x1b[1;5C'
          : event.alt
            ? '\x1b[1;3C'
            : event.shift
              ? '\x1b[1;2C'
              : '\x1b[C';
      case 'left':
        return event.ctrl
          ? '\x1b[1;5D'
          : event.alt
            ? '\x1b[1;3D'
            : event.shift
              ? '\x1b[1;2D'
              : '\x1b[D';
      case 'home':
        return '\x1b[H';
      case 'end':
        return '\x1b[F';
      case 'pageUp':
        return '\x1b[5~';
      case 'pageDown':
        return '\x1b[6~';
      case 'delete':
        return '\x1b[3~';
      case 'f1':
        return '\x1bOP';
      case 'f2':
        return '\x1bOQ';
      case 'f3':
        return '\x1bOR';
      case 'f4':
        return '\x1bOS';
      case 'f5':
        return '\x1b[15~';
      case 'f6':
        return '\x1b[17~';
      case 'f7':
        return '\x1b[18~';
      case 'f8':
        return '\x1b[19~';
      case 'f9':
        return '\x1b[20~';
      case 'f10':
        return '\x1b[21~';
      case 'f11':
        return '\x1b[23~';
      case 'f12':
        return '\x1b[24~';
    }
  }
  if (event.ch !== undefined) {
    if (event.ctrl && event.ch >= 'a' && event.ch <= 'z') {
      return String.fromCharCode(event.ch.charCodeAt(0) - 0x60);
    }
    if (event.alt) {
      return `\x1b${event.ch}`;
    }
    return event.ch;
  }
  throw new Error('mountWithInput.press: event has neither name, ch, nor sequence');
}

// ---------------------------------------------------------------------------
// InputMountHandle + mountWithInput
// ---------------------------------------------------------------------------

export interface InputMountHandle<T> extends MountHandle<T> {
  /** Dispatch a synthetic key event by emitting the corresponding raw bytes. */
  press(event: Partial<KeyEvent>): void;
  /** Convenience: press by KeyName with no modifiers. */
  pressKey(name: KeyName): void;
  /** Convenience: press a printable character. */
  pressChar(ch: string): void;
  /** Convenience: press Ctrl+<ch> (a–z). */
  pressCtrl(ch: string): void;
  /** The fake stdin used by this mount — for lifecycle assertions. */
  fakeStdin: FakeStdin;
}

/**
 * Like `mount`, but wraps the element in `StdinProvider` backed by a fake
 * stdin so that `press*` helpers can dispatch synthetic keystrokes through
 * the real parser chain.
 *
 * Public — exported from `@pilates/react/test-utils`. Intended for use in
 * test environments only.
 */
export function mountWithInput<T>(
  initial: T,
  renderFn: (state: T) => ReactElement,
  options: RenderToStringOptions,
): InputMountHandle<T> {
  const fakeStdin = makeFakeStdin();

  // We need access to flushSyncWork to flush after emitting data.
  // Re-implement mount's reconciler bootstrap inline so we can capture sync.
  let setter: ((next: T) => void) | null = null;
  const writes: string[] = [];

  // Inner must be a proper React *component* (not a plain function call) so
  // that hooks inside renderFn run within StdinProvider's context subtree.
  // Calling renderFn(state) directly during Wrapper's render would execute
  // hooks before StdinProvider has committed its context value.
  function Inner(props: { state: T }) {
    return renderFn(props.state);
  }

  // Stub provider values so apps using useApp/useStdout/useStderr work in
  // tests without an extra mount helper. Apps that don't use these hooks
  // are unaffected.
  const exitRef: { fn: (() => void) | null } = { fn: null };
  const appValue: AppHookValue = {
    exit: () => exitRef.fn?.(),
  };
  const stdoutValue: StdoutHookValue = {
    stdout: process.stdout,
    write: () => true,
    columns: options.width,
    rows: options.height,
  };
  const stderrValue: StderrHookValue = {
    stderr: process.stderr,
    write: () => true,
  };

  function Wrapper(props: { initial: T }) {
    const [state, setState] = useState(props.initial);
    setter = setState;
    return createElement(
      AppContext.Provider,
      { value: appValue },
      createElement(
        StdoutContext.Provider,
        { value: stdoutValue },
        createElement(
          StderrContext.Provider,
          { value: stderrValue },
          createElement(
            StdinProvider,
            { stdin: fakeStdin as unknown as NodeJS.ReadStream },
            createElement(Inner, { state }),
          ),
        ),
      ),
    );
  }

  const rootNode: ContainerNode = {
    width: options.width,
    height: options.height,
    children: [],
  };
  const container: RootContainer = {
    root: rootNode,
    prevFrame: null,
    onFlush: (ansi) => writes.push(ansi),
  };
  const reconciler = ReactReconciler(buildHostConfig());
  const handle = reconciler.createContainer(
    container,
    LegacyRoot,
    null,
    false,
    null,
    'pilates',
    () => {},
    null,
  );
  const sync = asSync(reconciler);
  // Wrap each reconciler operation in act() so that passive effects (useEffect
  // callbacks for StdinProvider's onData wiring and useInput's subscribe call)
  // fire synchronously via React's actQueue drain, rather than being deferred
  // to the event loop via the Scheduler's MessageChannel.
  //
  // IS_REACT_ACT_ENVIRONMENT is set for the duration of each act() call to
  // suppress React's "not configured to support act" warning without enabling
  // it globally (which would warn for all the other tests that don't use act).
  const withAct = (fn: () => void): void => {
    const g = globalThis as Record<string, unknown>;
    const prev = g.IS_REACT_ACT_ENVIRONMENT;
    g.IS_REACT_ACT_ENVIRONMENT = true;
    try {
      act(fn);
    } finally {
      g.IS_REACT_ACT_ENVIRONMENT = prev;
    }
  };

  withAct(() => {
    sync.updateContainerSync(createElement(Wrapper, { initial }), handle, null, null);
    sync.flushSyncWork();
  });

  const press = (event: Partial<KeyEvent>): void => {
    withAct(() => {
      const bytes = eventToBytes(event);
      fakeStdin.emit('data', bytes);
      sync.flushSyncWork();
    });
  };

  return {
    lastWrite: () => writes[writes.length - 1] ?? '',
    allWrites: () => writes.join(''),
    setState: (value) => {
      withAct(() => {
        if (!setter) throw new Error('setter not captured');
        setter(value);
        sync.flushSyncWork();
      });
    },
    unmount: ((): (() => void) => {
      const fn = () => {
        withAct(() => {
          sync.updateContainerSync(null, handle, null, null);
          sync.flushSyncWork();
        });
      };
      exitRef.fn = fn;
      return fn;
    })(),
    press,
    pressKey: (name: KeyName) => press({ name }),
    pressChar: (ch: string) => press({ ch }),
    pressCtrl: (ch: string) => press({ ch, ctrl: true }),
    fakeStdin,
  };
}
