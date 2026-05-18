/**
 * `inspectLayout` — a devtools / console dump of a computed-layout
 * subtree (phase 9). Pairs with `setLayoutProfiler`: the profiler
 * tells you *what the engine did*, this tells you *what it produced*.
 */

import { lastLayoutPath } from './algorithm/index.js';
import type { Node } from './node.js';

/** `left,top widthxheight` from a node's computed (rounded) layout. */
function boxOf(node: Node): string {
  const l = node.layout;
  return `${l.left},${l.top} ${l.width}x${l.height}`;
}

/**
 * Space-joined flags for one node: `scroll=WxH` when the content
 * extent overflows the box, and the node's dirty state.
 */
function flagsOf(node: Node): string {
  const l = node.layout;
  const flags: string[] = [];
  if (l.scrollWidth > l.width || l.scrollHeight > l.height) {
    flags.push(`scroll=${l.scrollWidth}x${l.scrollHeight}`);
  }
  if (node.isDirty()) flags.push('dirty');
  else if (node._hasDirtyDescendant) flags.push('dirty-desc');
  return flags.join(' ');
}

/**
 * A human-readable, indented dump of `node`'s computed-layout
 * subtree — one line per node, two spaces of indent per depth:
 *
 * ```
 * incremental  0,0 100x40
 *   0,0 30x40
 *   30,0 30x40  dirty
 * ```
 *
 * Each line is `left,top WxH` followed by any flags (`scroll=WxH`
 * when the content extent overflows the box; `dirty` /  `dirty-desc`
 * for pending-relayout state). The root line is prefixed with the
 * engine path its most recent `calculateLayout` took (`imperative` /
 * `build` / `graft` / `incremental`), when known.
 *
 * Pure — allocates only the returned string; for devtools and
 * console debugging, not a hot path.
 */
export function inspectLayout(node: Node): string {
  const lines: string[] = [];
  const visit = (n: Node, depth: number): void => {
    const flags = flagsOf(n);
    lines.push(`${'  '.repeat(depth)}${boxOf(n)}${flags === '' ? '' : `  ${flags}`}`);
    for (let i = 0; i < n.getChildCount(); i++) visit(n.getChild(i)!, depth + 1);
  };
  visit(node, 0);

  const path = lastLayoutPath(node);
  if (path !== undefined) lines[0] = `${path}  ${lines[0]}`;
  return lines.join('\n');
}
