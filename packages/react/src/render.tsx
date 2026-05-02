import type { ContainerNode } from '@pilates/render';
import {
  Fragment,
  type ReactElement,
  type ReactNode,
  createElement,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import ReactReconciler from 'react-reconciler';
import { LegacyRoot } from 'react-reconciler/constants.js';
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

function StdinProvider({
  stdin,
  children,
}: {
  stdin: NodeJS.ReadStream;
  children?: ReactNode;
}) {
  const stateRef = useRef({
    subscribers: new Map<(event: KeyEvent) => void, boolean>(),
    refcount: 0,
    remainder: '',
    rawModeOn: false,
  });
  const isRawModeSupported = stdin.isTTY === true;

  useEffect(() => {
    const state = stateRef.current;
    const onData = (chunk: Buffer | string) => {
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      const combined = state.remainder + text;
      const { events, remainder } = parseKeys(combined);
      state.remainder = remainder;
      for (const event of events) {
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
    };
    stdin.on('data', onData);
    return () => {
      stdin.off('data', onData);
      if (state.rawModeOn && isRawModeSupported) {
        try {
          stdin.setRawMode(false);
          state.rawModeOn = false;
        } catch {
          /* swallow on teardown */
        }
      }
    };
  }, [stdin, isRawModeSupported]);

  // Memoize the context value so the provider's identity survives parent
  // re-renders. Otherwise every parent state change would create a fresh
  // value, causing useInput's subscribe effect (deps include `v`) to tear
  // down and rebuild on every keystroke that triggered an update.
  const value = useMemo<StdinHookValue>(
    () => ({
      stdin,
      isRawModeSupported,
      subscribe: (handler) => {
        const state = stateRef.current;
        state.subscribers.set(handler, true);
        state.refcount += 1;
        ensureRawMode(stdin, state, isRawModeSupported);
        return () => {
          const wasActive = state.subscribers.get(handler) === true;
          state.subscribers.delete(handler);
          if (wasActive) {
            state.refcount -= 1;
            if (state.refcount === 0) releaseRawMode(stdin, state, isRawModeSupported);
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
          ensureRawMode(stdin, state, isRawModeSupported);
        } else {
          state.refcount -= 1;
          if (state.refcount === 0) releaseRawMode(stdin, state, isRawModeSupported);
        }
      },
    }),
    [stdin, isRawModeSupported],
  );
  return createElement(StdinContext.Provider, { value }, children);
}

interface StdinProviderState {
  subscribers: Map<(event: KeyEvent) => void, boolean>;
  refcount: number;
  remainder: string;
  rawModeOn: boolean;
}

function ensureRawMode(
  stdin: NodeJS.ReadStream,
  state: StdinProviderState,
  isRawModeSupported: boolean,
): void {
  if (!state.rawModeOn && isRawModeSupported) {
    try {
      stdin.setRawMode(true);
      stdin.resume();
      state.rawModeOn = true;
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
  state: StdinProviderState,
  isRawModeSupported: boolean,
): void {
  if (state.rawModeOn && isRawModeSupported) {
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

  const onUncaughtError = (err: Error) => finishUnmount(err, true);
  const onStreamError = (err: Error) => finishUnmount(err);

  const handle = reconciler.createContainer(
    container,
    LegacyRoot,
    null,
    false,
    null,
    'pilates',
    onUncaughtError,
    null,
  );

  const appValue: AppHookValue = {
    exit: (err) => finishUnmount(err),
  };
  const stderrValue: StderrHookValue = {
    stderr,
    write: (s) => stderr.write(s),
  };

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
          StdinProvider,
          { stdin },
          createElement(StderrContext.Provider, { value: stderrValue }, element),
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

export { StdinProvider };
