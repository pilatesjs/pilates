import { Box, Text, useFocus, useInput } from '@pilates/react';
import { type JSX, type ReactNode, useEffect, useRef, useState } from 'react';
import type { SelectItem } from './select.js';

export interface MultiSelectIndicatorProps {
  /** True when this row is the navigation cursor target. */
  isHighlighted: boolean;
  /** True when this row's value appears in `selectedKeys`. */
  isSelected: boolean;
  /** True when this row's `disabled` flag is set. */
  isDisabled: boolean;
}

export interface MultiSelectProps<T> {
  items: SelectItem<T>[];
  /**
   * Currently-selected items, keyed by `item.key ?? String(item.value)`.
   * Controlled — `onChange` produces the next Set.
   */
  selectedKeys: ReadonlySet<string>;
  /**
   * Called when the user toggles an item via Space. Receives a NEW Set
   * containing the resulting selection.
   */
  onChange: (next: Set<string>) => void;
  /**
   * Called when the user presses Enter. Receives the items currently in
   * `selectedKeys`, ordered to match `items`.
   */
  onSubmit?: (selected: SelectItem<T>[]) => void;
  /** Fires whenever the highlight cursor moves (skips initial mount). */
  onHighlight?: (item: SelectItem<T>) => void;
  /** Default 0; clamped forward to first non-disabled item. */
  initialIndex?: number;
  /**
   * Default true. Ignored when `focusId` is set — focus state then comes
   * from the `useFocus` registration instead.
   */
  focus?: boolean;
  /**
   * Register this MultiSelect with `useFocus(id)` so the surrounding
   * `<FocusProvider>` can route Tab / Shift+Tab cycling through it.
   */
  focusId?: string;
  /**
   * When `focusId` is set, take focus on mount if no other focusable
   * currently holds it.
   */
  autoFocus?: boolean;
  /** Custom marker rendered to the left of each row's label. */
  indicator?: (props: MultiSelectIndicatorProps) => ReactNode;
}

const ROW: { flexDirection: 'row'; flexGrow: 1; height: 1 } = {
  flexDirection: 'row',
  flexGrow: 1,
  height: 1,
};

function defaultIndicator({ isHighlighted, isSelected }: MultiSelectIndicatorProps): ReactNode {
  // Prefix is always 4 cells wide so labels line up across rows:
  //   highlighted + selected   →  "❯ ☑ "
  //   highlighted + unselected →  "❯ ☐ "
  //   plain      + selected    →  "  ☑ "
  //   plain      + unselected  →  "  ☐ "
  const cursorPart = isHighlighted ? <Text color="cyan">{'❯ '}</Text> : <Text>{'  '}</Text>;
  const checkPart = <Text>{isSelected ? '☑ ' : '☐ '}</Text>;
  return (
    <>
      {cursorPart}
      {checkPart}
    </>
  );
}

function clampToFirstEnabledForward(items: { disabled?: boolean }[], from: number): number {
  for (let i = from; i < items.length; i++) {
    if (!items[i]!.disabled) return i;
  }
  for (let i = 0; i < from; i++) {
    if (!items[i]!.disabled) return i;
  }
  return -1;
}

function findNext(items: { disabled?: boolean }[], from: number, direction: 1 | -1): number {
  if (items.length === 0) return -1;
  let i = from;
  for (let step = 0; step < items.length; step++) {
    i = (i + direction + items.length) % items.length;
    if (!items[i]!.disabled) return i;
  }
  return -1;
}

function keyOf<T>(item: SelectItem<T>): string {
  return item.key ?? String(item.value);
}

export function MultiSelect<T>({
  items,
  selectedKeys,
  onChange,
  onSubmit,
  onHighlight,
  initialIndex = 0,
  focus = true,
  focusId,
  autoFocus,
  indicator = defaultIndicator,
}: MultiSelectProps<T>): JSX.Element {
  const focusReg = useFocus({
    ...(focusId !== undefined ? { id: focusId } : {}),
    autoFocus: focusId !== undefined && (autoFocus ?? false),
    isActive: focusId !== undefined,
  });
  const effectiveFocus = focusId !== undefined ? focusReg.isFocused : focus;

  const [highlightIndex, setHighlightIndex] = useState(() =>
    clampToFirstEnabledForward(items, Math.max(0, Math.min(initialIndex, items.length - 1))),
  );

  // Re-clamp when `items` shrinks past the current index (mirrors Select's
  // behavior — without this, the highlight becomes invisible and Enter /
  // Space on the stale index silently no-op).
  // biome-ignore lint/correctness/useExhaustiveDependencies: highlightIndex is intentionally read but not depended on — clamping fires only when items mutate
  useEffect(() => {
    if (items.length === 0) return;
    if (highlightIndex >= 0 && highlightIndex < items.length && !items[highlightIndex]!.disabled) {
      return;
    }
    const clamped = clampToFirstEnabledForward(
      items,
      Math.max(0, Math.min(highlightIndex, items.length - 1)),
    );
    if (clamped !== highlightIndex) setHighlightIndex(clamped);
  }, [items]);

  // Fire onHighlight on cursor moves (not on initial mount).
  const isFirstRender = useRef(true);
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional — items/onHighlight read inside, only highlightIndex drives re-fires
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    if (highlightIndex >= 0 && highlightIndex < items.length) {
      onHighlight?.(items[highlightIndex]!);
    }
  }, [highlightIndex]);

  useInput(
    (event) => {
      if (items.length === 0) return;
      if (event.name === 'up') {
        setHighlightIndex((i) => {
          const next = findNext(items, i, -1);
          return next === -1 ? i : next;
        });
        return;
      }
      if (event.name === 'down') {
        setHighlightIndex((i) => {
          const next = findNext(items, i, 1);
          return next === -1 ? i : next;
        });
        return;
      }
      if (event.name === 'home') {
        const next = clampToFirstEnabledForward(items, 0);
        if (next !== -1) setHighlightIndex(next);
        return;
      }
      if (event.name === 'end') {
        for (let i = items.length - 1; i >= 0; i--) {
          if (!items[i]!.disabled) {
            setHighlightIndex(i);
            return;
          }
        }
        return;
      }
      if (event.name === 'space') {
        if (highlightIndex < 0 || highlightIndex >= items.length) return;
        const item = items[highlightIndex]!;
        if (item.disabled) return;
        const k = keyOf(item);
        const next = new Set(selectedKeys);
        if (next.has(k)) next.delete(k);
        else next.add(k);
        onChange(next);
        return;
      }
      if (event.name === 'enter') {
        if (!onSubmit) return;
        const selectedItems = items.filter((it) => selectedKeys.has(keyOf(it)));
        onSubmit(selectedItems);
        return;
      }
    },
    { isActive: effectiveFocus },
  );

  if (items.length === 0) return <Box flexGrow={1} height={1} />;

  return (
    <Box flexDirection="column" flexGrow={1}>
      {items.map((item, idx) => {
        const isHighlighted = effectiveFocus && idx === highlightIndex && !item.disabled;
        const isSelected = selectedKeys.has(keyOf(item));
        const k = keyOf(item);
        const labelEl = item.disabled ? <Text dim>{item.label}</Text> : <Text>{item.label}</Text>;
        return (
          <Box key={k} {...ROW}>
            {indicator({ isHighlighted, isSelected, isDisabled: !!item.disabled })}
            {labelEl}
          </Box>
        );
      })}
    </Box>
  );
}
