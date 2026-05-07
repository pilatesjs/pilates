import type { ContainerNode } from '@pilates/render';
import type { ComputedLayout } from '@pilates/render';
import type { MouseEvent } from './mouse-event.js';

export interface MouseHandlers {
  onClick?: (event: MouseEvent) => void;
  onWheel?: (event: MouseEvent) => void;
}

export const mouseRegistry = new WeakMap<ContainerNode, MouseHandlers>();

export function setMouseHandlers(
  node: ContainerNode,
  props: Record<string, unknown>,
): void {
  const onClick = props['onClick'] as MouseHandlers['onClick'] | undefined;
  const onWheel = props['onWheel'] as MouseHandlers['onWheel'] | undefined;
  if (onClick !== undefined || onWheel !== undefined) {
    const handlers: MouseHandlers = {};
    if (onClick !== undefined) handlers.onClick = onClick;
    if (onWheel !== undefined) handlers.onWheel = onWheel;
    mouseRegistry.set(node, handlers);
  } else {
    mouseRegistry.delete(node);
  }
}

export interface HitNode {
  node: ContainerNode;
  depth: number;
}

export function collectHits(
  root: ContainerNode,
  col: number,
  row: number,
  depth = 0,
  acc: HitNode[] = [],
): HitNode[] {
  const lo = (root as ContainerNode & { _layout?: ComputedLayout })._layout;
  if (lo !== undefined) {
    if (
      col >= lo.left &&
      col < lo.left + lo.width &&
      row >= lo.top &&
      row < lo.top + lo.height
    ) {
      acc.push({ node: root, depth });
    }
  }
  for (const child of root.children ?? []) {
    if (!('text' in child)) {
      collectHits(child as ContainerNode, col, row, depth + 1, acc);
    }
  }
  return acc;
}
