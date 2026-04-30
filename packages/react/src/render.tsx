import { createElement, Fragment, useEffect, useState, type ReactNode, type ReactElement } from 'react';
import ReactReconciler from 'react-reconciler';
import { LegacyRoot } from 'react-reconciler/constants.js';
import type { ContainerNode } from '@pilates/render';
import { buildHostConfig } from './host-config.js';
import {
  AppContext,
  type AppHookValue,
  StderrContext,
  type StderrHookValue,
  StdoutContext,
  type StdoutHookValue,
  useStdout,
} from './hooks.js';
import type { RootContainer } from './reconciler.js';

export interface RenderOptions {
  width?: number;
  height?: number;
  stdout?: NodeJS.WriteStream;
  stderr?: NodeJS.WriteStream;
}

export interface RenderInstance {
  unmount: () => void;
  waitUntilExit: () => Promise<void>;
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
}

function asSync(reconciler: ReturnType<typeof ReactReconciler>): SyncReconciler {
  return reconciler as unknown as SyncReconciler;
}

function StdoutProvider({ stdout, children }: { stdout: NodeJS.WriteStream; children?: ReactNode }) {
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

export function render(element: ReactElement, options: RenderOptions = {}): RenderInstance {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
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
        createElement(StderrContext.Provider, { value: stderrValue }, element),
      ),
    ),
  );

  if (typeof stdout.on === 'function') stdout.on('error', onStreamError);

  sync.updateContainerSync(wrapped, handle, null, null);
  sync.flushSyncWork();

  const instance: RenderInstance = {
    unmount: () => finishUnmount(),
    waitUntilExit: () => exitPromise,
  };

  return instance;
}
