import { createElement, type ReactElement } from 'react';
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

  const onUncaughtError = (err: Error) => {
    if (unmounted) return;
    unmounted = true;
    stderr.write(`\x1b[31mPilates render error:\x1b[0m ${err.message}\n${err.stack ?? ''}\n`);
    sync.updateContainerSync(null, handle, null, null);
    sync.flushSyncWork();
    rejectExit(err);
  };

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
    exit: (err) => {
      if (err) {
        instance.unmount();
        rejectExit(err);
      } else {
        instance.unmount();
        resolveExit();
      }
    },
  };
  const stdoutValue: StdoutHookValue = {
    stdout,
    write: (s) => stdout.write(s),
    columns: width,
    rows: height,
  };
  const stderrValue: StderrHookValue = {
    stderr,
    write: (s) => stderr.write(s),
  };

  const wrapped = createElement(
    AppContext.Provider,
    { value: appValue },
    createElement(
      StdoutContext.Provider,
      { value: stdoutValue },
      createElement(StderrContext.Provider, { value: stderrValue }, element),
    ),
  );

  sync.updateContainerSync(wrapped, handle, null, null);
  sync.flushSyncWork();

  const instance: RenderInstance = {
    unmount: () => {
      if (unmounted) return;
      unmounted = true;
      sync.updateContainerSync(null, handle, null, null);
      sync.flushSyncWork();
      stdout.write('\x1b[0m\n');
      resolveExit();
    },
    waitUntilExit: () => exitPromise,
  };

  return instance;
}
