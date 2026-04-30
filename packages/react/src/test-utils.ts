import { createElement, useState, type ReactElement } from 'react';
import ReactReconciler from 'react-reconciler';
import { LegacyRoot } from 'react-reconciler/constants.js';
import type { ContainerNode } from '@pilates/render';
import { buildHostConfig } from './host-config.js';
import type { RootContainer } from './reconciler.js';

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
 * Test-only — NOT in the public package barrel.
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
  const reconciler = ReactReconciler(buildHostConfig());
  const containerHandle = reconciler.createContainer(
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
  sync.updateContainerSync(element, containerHandle, null, null);
  sync.flushSyncWork();
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
 * Test-only — NOT in the public package barrel.
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
