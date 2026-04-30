import { type ReactElement } from 'react';
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
  const sync = reconciler as unknown as SyncReconciler;
  sync.updateContainerSync(element, containerHandle, null, null);
  sync.flushSyncWork();
  // Frame.toString() joins rows with `\n` but omits the trailing newline.
  // Tests treat rows as newline-terminated, so append one here.
  const out = container.prevFrame?.toString() ?? '';
  return out.length > 0 ? `${out}\n` : '';
}
