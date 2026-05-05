import { Box, Text, useFocus, useInput } from '@pilates/react';
import type { JSX } from 'react';

export interface TabsItem {
  /** Stable identifier passed to `onChange` when this tab is activated. */
  key: string;
  /** Display text. */
  label: string;
  /** When true, this tab cannot be activated and renders dimly. */
  disabled?: boolean;
}

export interface TabsProps {
  items: TabsItem[];
  /** Currently active tab key. Controlled — pair with `onChange`. */
  activeKey: string;
  /** Called when the user activates a different tab via arrow / Home / End. */
  onChange: (key: string) => void;
  /**
   * Default true. When false, does not consume keystrokes (active tab styling
   * still renders). Ignored when `focusId` is set.
   */
  focus?: boolean;
  /**
   * Register this strip with `useFocus(id)` so the surrounding
   * `<FocusProvider>` can route Tab / Shift+Tab cycling through it.
   */
  focusId?: string;
  /**
   * When `focusId` is set, take focus on mount if no other focusable
   * currently holds it.
   */
  autoFocus?: boolean;
}

const STRIP: { flexDirection: 'row'; height: 1 } = { flexDirection: 'row', height: 1 };

function findEnabled(items: TabsItem[], from: number, direction: 1 | -1): number {
  if (items.length === 0) return -1;
  let i = from;
  for (let step = 0; step < items.length; step++) {
    i = (i + direction + items.length) % items.length;
    if (!items[i]!.disabled) return i;
  }
  return -1;
}

function firstEnabled(items: TabsItem[]): number {
  for (let i = 0; i < items.length; i++) {
    if (!items[i]!.disabled) return i;
  }
  return -1;
}

function lastEnabled(items: TabsItem[]): number {
  for (let i = items.length - 1; i >= 0; i--) {
    if (!items[i]!.disabled) return i;
  }
  return -1;
}

/**
 * `<Tabs>` — horizontal tab strip. Controlled via `activeKey`. Arrow keys
 * cycle through enabled tabs; Home / End jump to the first / last enabled.
 *
 * The widget renders only the strip; it does not manage panel content. Wire
 * the body separately based on `activeKey`:
 *
 *     <Tabs items={items} activeKey={k} onChange={setK} />
 *     {k === 'overview' && <OverviewPanel />}
 *     {k === 'logs'     && <LogsPanel />}
 */
export function Tabs({
  items,
  activeKey,
  onChange,
  focus = true,
  focusId,
  autoFocus,
}: TabsProps): JSX.Element {
  const focusReg = useFocus({
    ...(focusId !== undefined ? { id: focusId } : {}),
    autoFocus: focusId !== undefined && (autoFocus ?? false),
    isActive: focusId !== undefined,
  });
  const effectiveFocus = focusId !== undefined ? focusReg.isFocused : focus;

  // -1 when activeKey doesn't match any item (e.g., consumer passed a stale
  // key after items shrank). Navigation handlers below recover by jumping to
  // the first enabled tab on the next move.
  const activeIdx = items.findIndex((it) => it.key === activeKey);

  useInput(
    (event) => {
      if (items.length === 0) return;

      const goTo = (idx: number): void => {
        if (idx < 0 || idx === activeIdx) return;
        const item = items[idx];
        if (!item || item.disabled) return;
        onChange(item.key);
      };

      if (event.name === 'right') {
        if (activeIdx === -1) {
          goTo(firstEnabled(items));
          return;
        }
        goTo(findEnabled(items, activeIdx, 1));
        return;
      }
      if (event.name === 'left') {
        if (activeIdx === -1) {
          goTo(lastEnabled(items));
          return;
        }
        goTo(findEnabled(items, activeIdx, -1));
        return;
      }
      if (event.name === 'home') {
        goTo(firstEnabled(items));
        return;
      }
      if (event.name === 'end') {
        goTo(lastEnabled(items));
        return;
      }
    },
    { isActive: effectiveFocus },
  );

  return (
    <Box {...STRIP}>
      {items.flatMap((item, idx) => renderTab(item, idx === activeIdx, idx > 0))}
    </Box>
  );
}

/**
 * Render one tab cell. Inactive tabs render as ` Label `; active tabs render
 * as `[Label]` in cyan + bold. Disabled tabs are rendered dim regardless of
 * active state. Returns an array (label cell + optional separator) so the
 * caller's `flatMap` interleaves them cleanly without extra container nodes.
 */
function renderTab(item: TabsItem, isActive: boolean, withLeadingSpace: boolean): JSX.Element[] {
  const out: JSX.Element[] = [];

  // A space between adjacent tabs keeps inactive labels from butting against
  // each other. Active tabs already have brackets so the separator is still
  // visually clean.
  if (withLeadingSpace) {
    out.push(<Text key={`sep-${item.key}`}> </Text>);
  }

  if (item.disabled) {
    out.push(
      <Text key={`tab-${item.key}`} dim>
        {isActive ? `[${item.label}]` : ` ${item.label} `}
      </Text>,
    );
    return out;
  }

  if (isActive) {
    out.push(
      <Text key={`tab-${item.key}`} color="cyan" bold>
        {`[${item.label}]`}
      </Text>,
    );
  } else {
    out.push(<Text key={`tab-${item.key}`}>{` ${item.label} `}</Text>);
  }
  return out;
}
