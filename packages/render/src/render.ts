/**
 * Public entry point: declarative tree → painted string.
 *
 *   render(tree, options?)        — string with ANSI styling (or stripped if
 *                                   stdout isn't a TTY).
 *   renderToFrame(tree, options?) — return the underlying Frame for callers
 *                                   that want to inspect cells, drive
 *                                   diff-based redraws, or run snapshots.
 */

import { build } from './build.js';
import { Frame } from './frame.js';
import { paint } from './painter.js';
import type { RenderNode, RenderOptions } from './types.js';

export function render(tree: RenderNode, options: RenderOptions = {}): string {
  const frame = renderToFrame(tree);
  const ansi = options.ansi ?? defaultAnsi();
  return frame.toString({ ansi });
}

export function renderToFrame(tree: RenderNode): Frame {
  const bridge = build(tree);
  bridge.root.calculateLayout();
  const layout = bridge.root.getComputedLayout();
  const frame = new Frame(layout.width, layout.height);
  paint(frame, bridge);
  return frame;
}

/**
 * `process.stdout.isTTY` is undefined when stdout is piped or redirected; in
 * that case we want plain output. When running outside Node (e.g. tests or
 * non-Node runtimes) default to ANSI on.
 */
function defaultAnsi(): boolean {
  if (typeof process === 'undefined') return true;
  if (typeof process.stdout === 'undefined') return true;
  return process.stdout.isTTY === true;
}
