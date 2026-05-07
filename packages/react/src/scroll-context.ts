import { type Context, createContext, type RefObject, useContext, useEffect } from 'react';

export interface FocusedBounds {
  start: number;
  size: number;
}

/** @internal Extended form used by useScrollIntoFocus. */
export interface FocusedBoundsWithNode extends FocusedBounds {
  /** The render-tree node of the focused Box, used as a fallback locator
   *  when `size` is 0 (Box-wrapping-Text gives zero height in Pilates). */
  _node?: object;
}

export interface ScrollContextValue {
  notifyFocusedBounds: (bounds: FocusedBoundsWithNode) => void;
}

export const ScrollContext: Context<ScrollContextValue> = createContext<ScrollContextValue>({
  notifyFocusedBounds: () => {},
});

/**
 * A Pilates Box host instance as seen through a forwarded ref.
 * `getPublicInstance` in the host config returns `{ kind: 'box', node: ContainerNode }`.
 * `_layout` lives on `node`, not on the instance itself.
 */
interface BoxHostInstance {
  kind: 'box';
  node: {
    _layout?: { top: number; left: number; height: number; width: number };
  };
}

/**
 * Notify the nearest enclosing `<ScrollView>` to scroll the referenced node
 * into the visible viewport when `isFocused` becomes true.
 *
 * `nodeRef` must point to a Pilates `<Box>` element. The hook reads `_layout`
 * from the Box's underlying render node after each commit and forwards the
 * resulting bounds to the scroll context.
 *
 * When the Box's `_layout.height` is 0 (the common case for `<Box>` wrapping
 * `<Text>` in Pilates — text height is attributed to the TextNode, not the
 * parent Box), the node reference is forwarded alongside the zero bounds so
 * `<ScrollView>` can locate the item by scanning its child list.
 */
export function useScrollIntoFocus(
  isFocused: boolean,
  nodeRef: RefObject<unknown>,
): void {
  const ctx = useContext(ScrollContext);
  useEffect(() => {
    if (!isFocused) return;
    const inst = nodeRef.current as BoxHostInstance | null | undefined;
    if (!inst || inst.kind !== 'box') return;
    const lo = inst.node._layout;
    if (!lo) return;
    ctx.notifyFocusedBounds({ start: lo.top, size: lo.height, _node: inst.node });
  }, [isFocused, ctx, nodeRef]);
}
