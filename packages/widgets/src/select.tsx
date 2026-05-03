import { Box, Text, useInput } from '@pilates/react';
import { type JSX, type ReactNode, useEffect, useRef, useState } from 'react';

export interface SelectItem<T> {
  label: string;
  value: T;
  /** Stable identity for React reconciliation. Defaults to `String(value)` if omitted. */
  key?: string;
  /** When true, item cannot receive highlight or be selected. */
  disabled?: boolean;
}

export interface SelectIndicatorProps {
  isHighlighted: boolean;
  isDisabled: boolean;
}

export interface SelectProps<T> {
  items: SelectItem<T>[];
  onSelect: (item: SelectItem<T>) => void;
  onHighlight?: (item: SelectItem<T>) => void;
  /** Default 0; clamped forward to first non-disabled item. */
  initialIndex?: number;
  /** Default true. */
  focus?: boolean;
  /** Custom marker rendered to the left of each row. */
  indicator?: (props: SelectIndicatorProps) => ReactNode;
}

const ROW: { flexDirection: 'row'; flexGrow: 1; height: 1 } = {
  flexDirection: 'row',
  flexGrow: 1,
  height: 1,
};

function defaultIndicator({ isHighlighted }: SelectIndicatorProps): ReactNode {
  return isHighlighted ? <Text color="cyan">❯ </Text> : <Text>{'  '}</Text>;
}

function clampToFirstEnabledForward(items: { disabled?: boolean }[], from: number): number {
  for (let i = from; i < items.length; i++) {
    if (!items[i]!.disabled) return i;
  }
  for (let i = 0; i < from; i++) {
    if (!items[i]!.disabled) return i;
  }
  return -1; // every item disabled
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

export function Select<T>({
  items,
  onSelect,
  onHighlight,
  initialIndex = 0,
  focus = true,
  indicator = defaultIndicator,
}: SelectProps<T>): JSX.Element {
  const [highlightIndex, setHighlightIndex] = useState(() =>
    clampToFirstEnabledForward(items, Math.max(0, Math.min(initialIndex, items.length - 1))),
  );

  // Re-clamp the highlight when `items` shrinks (or restructures) past the
  // current index. Without this, a stale index produces a silent no-op on
  // Enter and an invisible highlight in the rendered output.
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

  // Fire onHighlight whenever highlightIndex changes (skip initial mount).
  const isFirstRender = useRef(true);
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional — items/onHighlight are stable refs read inside, only highlightIndex drives re-fires
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
      if (event.name === 'enter') {
        if (highlightIndex < 0 || highlightIndex >= items.length) return;
        const item = items[highlightIndex]!;
        if (item.disabled) return;
        onSelect(item);
        return;
      }
    },
    { isActive: focus },
  );

  if (items.length === 0) return <Box flexGrow={1} height={1} />;

  return (
    <Box flexDirection="column" flexGrow={1}>
      {items.map((item, idx) => {
        const isHighlighted = idx === highlightIndex && !item.disabled;
        const k = item.key ?? String(item.value);
        const labelEl = item.disabled ? <Text dim>{item.label}</Text> : <Text>{item.label}</Text>;
        return (
          <Box key={k} {...ROW}>
            {indicator({ isHighlighted, isDisabled: !!item.disabled })}
            {labelEl}
          </Box>
        );
      })}
    </Box>
  );
}
