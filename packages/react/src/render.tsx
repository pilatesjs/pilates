import type { ContainerNode } from '@pilates/render';
import type { MouseEvent } from './mouse-event.js';
import {
  Fragment,
  type ReactElement,
  type ReactNode,
  createContext,
  createElement,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { collectHits, mouseRegistry } from './mouse-registry.js';
import type { HitNode } from './mouse-registry.js';
import ReactReconciler from 'react-reconciler';
import { LegacyRoot } from 'react-reconciler/constants.js';
import { isPilatesError } from './errors/index.js';
import { FocusProvider, type FocusProviderProps } from './focus.js';
import {
  AppContext,
  type AppHookValue,
  type KeyEvent,
  StderrContext,
  type StderrHookValue,
  StdinContext,
  type StdinHookValue,
  StdoutContext,
  type StdoutHookValue,
  useStdout,
} from './hooks.js';
import { buildHostConfig } from './host-config.js';
import { parse as parseKeys } from './key-parser.js';
import type { RootContainer } from './reconciler.js';

export interface RenderOptions {
  width?: number;
  height?: number;
  stdout?: NodeJS.WriteStream;
  stderr?: NodeJS.WriteStream;
  stdin?: NodeJS.ReadStream;
  /**
   * Focus management (Tab / Shift+Tab cycling via `useFocus` /
   * `useFocusManager`). Default: enabled with `autoTab: true`,
   * `blurOnEscape: false`. Pass `false` to opt out entirely — Tab and
   * Shift+Tab then flow through to user `useInput` handlers.
   */
  focus?: FocusProviderProps | false;
}

export interface RenderInstance {
  unmount: () => void;
  waitUntilExit: () => Promise<void>;
}

/**
 * react-reconciler@0.31 split the legacy synchronous flush into
 * `updateContainerSync` + `flushSyncWork`. The @types/react-reconciler
 * @0.28.9 surface doesn't list these yet, so we cast at the boundary.
 *
 * `flushPassiveEffects` drains pending useEffect callbacks; we need it
 * inside `render()` so listeners (stdin data handlers, raw-mode toggle)
 * are bound before the function returns, instead of one event-loop tick
 * later when stdin might not yet hold the loop alive.
 */
interface SyncReconciler {
  updateContainerSync(
    element: unknown,
    container: unknown,
    parent: unknown,
    callback: (() => void) | null,
  ): void;
  flushSyncWork(): void;
  flushPassiveEffects(): boolean;
}

function asSync(reconciler: ReturnType<typeof ReactReconciler>): SyncReconciler {
  return reconciler as unknown as SyncReconciler;
}

function StdoutProvider({
  stdout,
  children,
}: { stdout: NodeJS.WriteStream; children?: ReactNode }) {
  const [dims, setDims] = useState({ columns: stdout.columns ?? 80, rows: stdout.rows ?? 24 });
  useEffect(() => {
    if (!stdout.isTTY) return;
    const handler = () => setDims({ columns: stdout.columns ?? 80, rows: stdout.rows ?? 24 });
    stdout.on('resize', handler);
    return () => {
      stdout.off('resize', handler);
    };
  }, [stdout]);
  const value: StdoutHookValue = {
    stdout,
    write: (s) => stdout.write(s),
    columns: dims.columns,
    rows: dims.rows,
  };
  return createElement(StdoutContext.Provider, { value }, children);
}

function ResizeBridge({
  rootNode,
  container,
  children,
}: {
  rootNode: ContainerNode;
  container: RootContainer;
  children?: ReactNode;
}) {
  const { columns, rows } = useStdout();
  const [, force] = useState(0);
  useEffect(() => {
    rootNode.width = columns;
    rootNode.height = rows;
    container.prevFrame = null; // force full repaint on next commit
    force((n) => n + 1);
  }, [columns, rows, rootNode, container]);
  return createElement(Fragment, null, children);
}

interface MouseContextValue {
  hitTestAndBubble: (event: MouseEvent) => void;
}

const MouseContext = createContext<MouseContextValue | null>(null);

function MouseProvider({
  container,
  children,
}: {
  container: RootContainer;
  children?: ReactNode;
}) {
  const hitRef = useRef<((event: MouseEvent) => void) | null>(null);
  if (hitRef.current === null) {
    hitRef.current = (event: MouseEvent): void => {
      const hits: HitNode[] = collectHits(
        container.root,
        event.col - 1,
        event.row - 1,
      );
      hits.sort((a, b) => b.depth - a.depth);
      let stopped = false;
      const ev: MouseEvent = {
        ...event,
        stopPropagation: () => { stopped = true; },
      };
      for (const { node } of hits) {
        if (stopped) break;
        const handlers = mouseRegistry.get(node);
        if (handlers === undefined) continue;
        const isWheel = event.button === 'wheel-up' || event.button === 'wheel-down';
        if (isWheel) {
          handlers.onWheel?.(ev);
        } else if (event.pressed) {
          handlers.onClick?.(ev);
        }
      }
    };
  }
  const value = useMemo<MouseContextValue>(
    () => ({ hitTestAndBubble: hitRef.current! }),
    [],
  );
  return createElement(MouseContext.Provider, { value }, children);
}

function StdinProvider({
  stdin,
  children,
}: {
  stdin: NodeJS.ReadStream;
  children?: ReactNode;
}) {
  // Read the stdout `write` fn from context so bracketed-paste enable /
  // disable sequences land on the same stream as the rendered frame.
  // Required because DEC mode 2004 is a terminal-side flag set via
  // output bytes — even though it controls how stdin delivers paste
  // payloads. Going through the hook's `write` (rather than the raw
  // `stdout` handle) lets test utilities stub it out without leaking
  // escape sequences to process.stdout.
  //
  // StdoutProvider creates a fresh `write` reference on every render, so
  // capture the latest in a ref and call it through a stable wrapper.
  // This keeps the context value's identity stable (no churn on parent
  // re-render or SIGWINCH resize) and avoids re-firing subscribe effects.
  const { write: latestStdoutWrite } = useStdout();
  const latestWriteRef = useRef(latestStdoutWrite);
  latestWriteRef.current = latestStdoutWrite;
  const stableWriteRef = useRef<((s: string) => boolean) | null>(null);
  if (stableWriteRef.current === null) {
    stableWriteRef.current = (s) => latestWriteRef.current(s);
  }
  const stdoutWrite = stableWriteRef.current;
  const mouseCtx = useContext(MouseContext);
  const mouseCtxRef = useRef(mouseCtx);
  mouseCtxRef.current = mouseCtx;
  const stateRef = useRef<StdinProviderState>({
    subscribers: new Map<(event: KeyEvent) => void, boolean>(),
    pasteSubscribers: new Set<(text: string) => void>(),
    refcount: 0,
    remainder: '',
    rawModeOn: false,
    escapeTimer: null,
    mouseSubscribers: new Map<(event: MouseEvent) => void, boolean>(),
    mouseRefcount: 0,
    mouseModeOn: false,
  });
  const isRawModeSupported = stdin.isTTY === true;

  useEffect(() => {
    const state = stateRef.current;
    const onData = (chunk: Buffer | string) => {
      // A new byte cancels any pending bare-ESC disambiguation: it could be
      // the rest of a CSI/SS3/Alt sequence whose ESC prefix we've been holding.
      if (state.escapeTimer !== null) {
        clearTimeout(state.escapeTimer);
        state.escapeTimer = null;
      }
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      const combined = state.remainder + text;
      const { events, mouseEvents, pastes, remainder } = parseKeys(combined);
      state.remainder = remainder;
      for (const event of events) {
        dispatchEvent(state, event);
      }
      for (const mev of mouseEvents) {
        dispatchMouseEvent(state, mev);
        mouseCtxRef.current?.hitTestAndBubble(mev);
      }
      for (const paste of pastes) {
        dispatchPaste(state, paste);
      }
      // If the parser is sitting on a held bare ESC, schedule a flush. If
      // another byte arrives in the disambiguation window we'll cancel it
      // and re-parse the combined stream.
      if (remainder === '\x1b') {
        state.escapeTimer = setTimeout(() => flushHeldEscape(state), ESCAPE_DISAMBIGUATION_MS);
      }
    };
    stdin.on('data', onData);
    return () => {
      stdin.off('data', onData);
      if (state.escapeTimer !== null) {
        clearTimeout(state.escapeTimer);
        state.escapeTimer = null;
      }
      releaseMouseMode(stdoutWrite, state);
      if (state.rawModeOn && isRawModeSupported) {
        releaseRawMode(stdin, stdoutWrite, state, isRawModeSupported);
      }
    };
  }, [stdin, stdoutWrite, isRawModeSupported]);

  // Memoize the context value so the provider's identity survives parent
  // re-renders. Otherwise every parent state change would create a fresh
  // value, causing useInput's subscribe effect (deps include `v`) to tear
  // down and rebuild on every keystroke that triggered an update.
  const value = useMemo<StdinHookValue>(
    () => ({
      stdin,
      isRawModeSupported,
      subscribe: (handler, initialActive = true) => {
        const state = stateRef.current;
        state.subscribers.set(handler, initialActive);
        if (initialActive) {
          state.refcount += 1;
          ensureRawMode(stdin, stdoutWrite, state, isRawModeSupported);
        }
        return () => {
          const wasActive = state.subscribers.get(handler) === true;
          state.subscribers.delete(handler);
          if (wasActive) {
            state.refcount -= 1;
            if (state.refcount === 0) releaseRawMode(stdin, stdoutWrite, state, isRawModeSupported);
          }
        };
      },
      setActive: (handler, active) => {
        const state = stateRef.current;
        const current = state.subscribers.get(handler);
        if (current === undefined) return;
        if (current === active) return;
        state.subscribers.set(handler, active);
        if (active) {
          state.refcount += 1;
          ensureRawMode(stdin, stdoutWrite, state, isRawModeSupported);
        } else {
          state.refcount -= 1;
          if (state.refcount === 0) releaseRawMode(stdin, stdoutWrite, state, isRawModeSupported);
        }
      },
      subscribePaste: (handler) => {
        const state = stateRef.current;
        state.pasteSubscribers.add(handler);
        state.refcount += 1;
        ensureRawMode(stdin, stdoutWrite, state, isRawModeSupported);
        return () => {
          if (!state.pasteSubscribers.delete(handler)) return;
          state.refcount -= 1;
          if (state.refcount === 0) releaseRawMode(stdin, stdoutWrite, state, isRawModeSupported);
        };
      },
      subscribeMouseEvent: (handler, initialActive = true) => {
        const state = stateRef.current;
        state.mouseSubscribers.set(handler, initialActive);
        if (initialActive) {
          state.mouseRefcount += 1;
          state.refcount += 1; // hold raw mode while mouse mode is active
          ensureMouseMode(stdin, stdoutWrite, state, isRawModeSupported);
        }
        return () => {
          const wasActive = state.mouseSubscribers.get(handler) === true;
          state.mouseSubscribers.delete(handler);
          if (wasActive) {
            state.mouseRefcount -= 1;
            state.refcount -= 1;
            if (state.mouseRefcount === 0) releaseMouseMode(stdoutWrite, state);
            if (state.refcount === 0) releaseRawMode(stdin, stdoutWrite, state, isRawModeSupported);
          }
        };
      },
      setMouseActive: (handler, active) => {
        const state = stateRef.current;
        const current = state.mouseSubscribers.get(handler);
        if (current === undefined) return;
        if (current === active) return;
        state.mouseSubscribers.set(handler, active);
        if (active) {
          state.mouseRefcount += 1;
          state.refcount += 1;
          ensureMouseMode(stdin, stdoutWrite, state, isRawModeSupported);
        } else {
          state.mouseRefcount -= 1;
          state.refcount -= 1;
          if (state.mouseRefcount === 0) releaseMouseMode(stdoutWrite, state);
          if (state.refcount === 0) releaseRawMode(stdin, stdoutWrite, state, isRawModeSupported);
        }
      },
    }),
    [stdin, stdoutWrite, isRawModeSupported],
  );
  return createElement(StdinContext.Provider, { value }, children);
}

interface StdinProviderState {
  subscribers: Map<(event: KeyEvent) => void, boolean>;
  pasteSubscribers: Set<(text: string) => void>;
  refcount: number;
  remainder: string;
  rawModeOn: boolean;
  /** Pending timer that flushes a held bare ESC as a real Escape event. */
  escapeTimer: ReturnType<typeof setTimeout> | null;
  // ↓ new mouse fields
  mouseSubscribers: Map<(event: MouseEvent) => void, boolean>;
  mouseRefcount: number;
  mouseModeOn: boolean;
}

/**
 * xterm DEC private mode 2004 — when set, the terminal wraps pasted
 * content in `\x1b[200~` … `\x1b[201~` so we can deliver it as a single
 * payload through `usePaste` instead of emitting one keystroke per byte
 * (which would, e.g., fire Enter on every newline in the paste).
 */
const PASTE_MODE_ENABLE = '\x1b[?2004h';
const PASTE_MODE_DISABLE = '\x1b[?2004l';

/**
 * Bare ESC at end-of-chunk is ambiguous: it could be a real Escape press
 * or the prefix of a CSI / SS3 / Alt sequence whose remaining bytes are
 * still in flight. The parser holds it as `remainder`; we flush it as a
 * real Escape if no follow-up byte arrives within this window. xterm /
 * ink use a similar disambiguation timeout (~50ms is industry standard).
 */
const ESCAPE_DISAMBIGUATION_MS = 50;

const MOUSE_MODE_ENABLE  = '\x1b[?1000h\x1b[?1006h';
const MOUSE_MODE_DISABLE = '\x1b[?1006l\x1b[?1000l';

function ensureMouseMode(
  stdin: NodeJS.ReadStream,
  stdoutWrite: (s: string) => boolean,
  state: StdinProviderState,
  isRawModeSupported: boolean,
): void {
  if (!state.mouseModeOn) {
    ensureRawMode(stdin, stdoutWrite, state, isRawModeSupported);
    try {
      stdoutWrite(MOUSE_MODE_ENABLE);
      state.mouseModeOn = true;
    } catch {
      /* terminal may not support mouse reporting — swallow */
    }
  }
}

function releaseMouseMode(
  stdoutWrite: (s: string) => boolean,
  state: StdinProviderState,
): void {
  if (state.mouseModeOn) {
    try {
      stdoutWrite(MOUSE_MODE_DISABLE);
    } catch {
      /* swallow */
    }
    state.mouseModeOn = false;
  }
}

function dispatchEvent(state: StdinProviderState, event: KeyEvent): void {
  for (const [handler, active] of state.subscribers) {
    if (!active) continue;
    try {
      handler(event);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`Pilates: useInput handler threw: ${msg}\n`);
    }
  }
}

function dispatchPaste(state: StdinProviderState, text: string): void {
  for (const handler of state.pasteSubscribers) {
    try {
      handler(text);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`Pilates: usePaste handler threw: ${msg}\n`);
    }
  }
}

function dispatchMouseEvent(state: StdinProviderState, event: MouseEvent): void {
  for (const [handler, active] of state.mouseSubscribers) {
    if (!active) continue;
    try {
      handler(event);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`Pilates: useMouse handler threw: ${msg}\n`);
    }
  }
}

function flushHeldEscape(state: StdinProviderState): void {
  state.escapeTimer = null;
  if (state.remainder !== '\x1b') return;
  state.remainder = '';
  dispatchEvent(state, {
    name: 'escape',
    ctrl: false,
    alt: false,
    shift: false,
    sequence: '\x1b',
  });
}

function ensureRawMode(
  stdin: NodeJS.ReadStream,
  stdoutWrite: (s: string) => boolean,
  state: StdinProviderState,
  isRawModeSupported: boolean,
): void {
  if (!state.rawModeOn && isRawModeSupported) {
    try {
      stdin.setRawMode(true);
      stdin.resume();
      state.rawModeOn = true;
      // Bracketed paste opt-in is paired with raw mode: same TTY gate,
      // same lifetime. Write failures are non-fatal — the worst case is
      // a paste comes through as a stream of keystrokes (pre-2004 behavior).
      try {
        stdoutWrite(PASTE_MODE_ENABLE);
      } catch {
        /* swallow — terminal just won't bracket pastes */
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(
        `Pilates: raw stdin mode not available; keystroke dispatch may be line-buffered (${msg})\n`,
      );
    }
  } else if (!isRawModeSupported) {
    try {
      stdin.resume();
    } catch {
      /* ignore */
    }
  }
}

function releaseRawMode(
  stdin: NodeJS.ReadStream,
  stdoutWrite: (s: string) => boolean,
  state: StdinProviderState,
  isRawModeSupported: boolean,
): void {
  if (state.rawModeOn && isRawModeSupported) {
    try {
      stdoutWrite(PASTE_MODE_DISABLE);
    } catch {
      /* swallow */
    }
    try {
      stdin.setRawMode(false);
      state.rawModeOn = false;
    } catch {
      /* swallow */
    }
  }
}

export function render(element: ReactElement, options: RenderOptions = {}): RenderInstance {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const stdin = options.stdin ?? process.stdin;
  const width = options.width ?? stdout.columns ?? 80;
  const height = options.height ?? stdout.rows ?? 24;

  let unmounted = false;
  let resolveExit!: () => void;
  let rejectExit!: (err: Error) => void;
  const exitPromise = new Promise<void>((res, rej) => {
    resolveExit = res;
    rejectExit = rej;
  });

  const rootNode: ContainerNode = { width, height, children: [] };
  const container: RootContainer = {
    root: rootNode,
    prevFrame: null,
    onFlush: (ansi) => stdout.write(ansi),
  };

  const reconciler = ReactReconciler(buildHostConfig());
  const sync = asSync(reconciler);

  // Centralised teardown so resolve/reject is decided exactly once, no
  // matter which entry point initiated the exit (direct unmount call,
  // useApp().exit(), useApp().exit(error), an uncaught render error,
  // or a stdout stream 'error' event).
  const finishUnmount = (err?: Error, writeBanner = false): void => {
    if (unmounted) return;
    unmounted = true;
    if (typeof stdout.off === 'function') stdout.off('error', onStreamError);
    if (writeBanner && err) {
      stderr.write(`\x1b[31mPilates render error:\x1b[0m ${err.message}\n${err.stack ?? ''}\n`);
    }
    sync.updateContainerSync(null, handle, null, null);
    sync.flushSyncWork();
    stdout.write('\x1b[0m\n');
    if (err) rejectExit(err);
    else resolveExit();
  };

  const onStreamError = (err: Error) => finishUnmount(err);

  // react-reconciler@0.31 takes onUncaughtError + onCaughtError +
  // onRecoverableError at positions 7-9. The @types/react-reconciler@0.28.9
  // surface still describes the older 8-arg shape, so we cast through the
  // 14-arg form. Without onCaughtError as a function, an ErrorBoundary
  // catch crashes inside React's logCaughtError ("is not a function").
  type CreateContainer14 = (
    a: unknown,
    b: unknown,
    c: unknown,
    d: boolean,
    e: unknown,
    f: string,
    onUncaught: (err: Error, info: unknown) => void,
    onCaught: (err: Error, info: unknown) => void,
    onRecoverable: (err: Error, info: unknown) => void,
  ) => unknown;
  const create14 = reconciler.createContainer as unknown as CreateContainer14;

  // react-reconciler@0.31 passes `{ componentStack?: string }` as the second
  // arg. The @types/react-reconciler surface types it as `unknown`, so we
  // narrow inside the helper rather than at the callback signature.
  const attachComponentStack = (error: Error, info: unknown): void => {
    const stack = (info as { componentStack?: string } | null)?.componentStack;
    if (isPilatesError(error) && stack && !error.componentStack) {
      error.componentStack = stack;
    }
  };

  const onUncaughtError = (err: Error, info: unknown): void => {
    attachComponentStack(err, info);
    finishUnmount(err, true);
  };

  const onCaughtError = (err: Error, info: unknown): void => {
    attachComponentStack(err, info);
    // ErrorBoundary already produced a fallback UI. Surface the error to
    // stderr so it isn't silently swallowed.
    stderr.write(`Pilates: caught render error: ${err.message}\n`);
  };

  const onRecoverableError = (err: Error, info: unknown): void => {
    attachComponentStack(err, info);
    stderr.write(`Pilates: recoverable render error: ${err.message}\n`);
  };
  const handle = create14(
    container,
    LegacyRoot,
    null,
    false,
    null,
    'pilates',
    onUncaughtError,
    onCaughtError,
    onRecoverableError,
  );

  const appValue: AppHookValue = {
    exit: (err) => finishUnmount(err),
  };
  const stderrValue: StderrHookValue = {
    stderr,
    write: (s) => stderr.write(s),
  };

  const focusOpt = options.focus;
  const stderrAndElement = createElement(StderrContext.Provider, { value: stderrValue }, element);
  const stdinChildren =
    focusOpt === false
      ? stderrAndElement
      : createElement(FocusProvider, focusOpt ?? null, stderrAndElement);

  const wrapped = createElement(
    AppContext.Provider,
    { value: appValue },
    createElement(
      StdoutProvider,
      { stdout },
      createElement(
        ResizeBridge,
        { rootNode, container },
        createElement(
          MouseProvider,
          { container },
          createElement(StdinProvider, { stdin }, stdinChildren),
        ),
      ),
    ),
  );

  if (typeof stdout.on === 'function') stdout.on('error', onStreamError);

  sync.updateContainerSync(wrapped, handle, null, null);
  sync.flushSyncWork();
  // Drain passive effects synchronously before returning. Without this,
  // StdinProvider's `stdin.on('data')` + `setRawMode(true)` + `resume()`
  // wouldn't fire until the next event-loop tick — by which point Node
  // may have already exited (nothing else holding the loop alive). Each
  // effect run can schedule further sync state updates (e.g.,
  // ResizeBridge's `force(n => n + 1)`), so loop until quiescent. The
  // bound is a safety net against pathological effect chains; real apps
  // settle in 1-2 iterations.
  for (let i = 0; i < 8; i++) {
    if (!sync.flushPassiveEffects()) break;
    sync.flushSyncWork();
  }

  const instance: RenderInstance = {
    unmount: () => finishUnmount(),
    waitUntilExit: () => exitPromise,
  };

  return instance;
}

export { StdinProvider, MouseProvider };
