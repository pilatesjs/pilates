# Mouse Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add terminal SGR mouse support to `@pilates/react` — `onClick`/`onWheel` props on `<Box>`, `useMouse` raw hook, `ScrollView` wheel scrolling, ref-counted mouse mode, and `sendMouseEvent` in test-utils.

**Architecture:** Parse SGR mouse sequences (`\x1b[<Pb;Px;PyM`) from stdin alongside existing key events. A `WeakMap<ContainerNode, MouseHandlers>` (written by `host-config.ts`) stores per-box handlers. On each mouse event, `MouseProvider.hitTestAndBubble` walks the render tree, hit-tests `_layout`, and bubbles handlers deepest-first with optional `stopPropagation`.

**Tech Stack:** TypeScript, React 18 (custom reconciler via `react-reconciler@0.31`), `@pilates/render` (layout tree + `_layout`), `vitest`

**Spec:** `docs/superpowers/specs/2026-05-07-mouse-support-design.md`

---

## File Map

**New files:**
- `packages/react/src/mouse-event.ts` — `MouseButton` + `MouseEvent` types
- `packages/react/src/mouse-parser.ts` — `parseSgrMouse()` function
- `packages/react/src/mouse-registry.ts` — `mouseRegistry` WeakMap + `setMouseHandlers` + `collectHits`
- `packages/react/src/mouse-parser.test.ts` — parser unit tests
- `packages/react/src/mouse-registry.test.ts` — registry + hit-test unit tests
- `packages/react/src/use-mouse.test.tsx` — `useMouse` hook integration test
- `packages/react/src/mouse-dispatch.test.tsx` — `onClick`/`onWheel`/bubble/`stopPropagation` integration tests
- `packages/react/src/scroll-view-mouse.test.tsx` — `ScrollView` wheel tests

**Modified files:**
- `packages/react/src/key-parser.ts` — add `mouseEvents` to `ParseResult`; route SGR sequences to `parseSgrMouse`
- `packages/react/src/hooks.ts` — add `subscribeMouseEvent`/`setMouseActive` to `StdinHookValue`; add `UseMouseOptions`; add `useMouse`
- `packages/react/src/render.tsx` — `StdinProviderState` mouse fields; `ensureMouseMode`/`releaseMouseMode`; `dispatchMouseEvent`; `MouseContext`; `MouseProvider`; wire `onData`; insert `MouseProvider` in hierarchy
- `packages/react/src/host-config.ts` — strip `onClick`/`onWheel` from render node; call `setMouseHandlers`
- `packages/react/src/components.tsx` — add `onClick`/`onWheel` to `BoxProps`
- `packages/react/src/scroll-view.tsx` — add `onWheel` handler to inner `<Box>`
- `packages/react/src/test-utils.ts` — add `MouseProvider` to `mountWithInput`; add `encodeSgrMouseBytes`; add `sendMouseEvent`
- `packages/react/src/index.ts` — export `useMouse`, `MouseEvent`, `MouseButton`, `UseMouseOptions`

---

## Task 1: `mouse-event.ts` — types

**Files:**
- Create: `packages/react/src/mouse-event.ts`

- [ ] **Step 1: Create the file**

```ts
// packages/react/src/mouse-event.ts

export type MouseButton =
  | 'left'
  | 'middle'
  | 'right'
  | 'wheel-up'
  | 'wheel-down'
  | 'none'; // mouse-move, no button pressed

export interface MouseEvent {
  /** 1-based terminal column (leftmost = 1). */
  col: number;
  /** 1-based terminal row (topmost = 1). */
  row: number;
  button: MouseButton;
  /** true = press / wheel tick. false = button release. */
  pressed: boolean;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  /** Raw SGR escape sequence that produced this event. */
  sequence: string;
  /** Call to stop bubbling to ancestor boxes. No-op on raw `useMouse` events. */
  stopPropagation: () => void;
}
```

- [ ] **Step 2: Type-check**

```bash
cd packages/react && pnpm tsc -p tsconfig.typecheck.json --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/react/src/mouse-event.ts
git commit -m "feat(react): add MouseEvent and MouseButton types"
```

---

## Task 2: `mouse-parser.ts` + `mouse-parser.test.ts` (TDD)

**Files:**
- Create: `packages/react/src/mouse-parser.ts`
- Create: `packages/react/src/mouse-parser.test.ts`

SGR mouse format: `\x1b[<Pb;Px;PyM` (press) or `\x1b[<Pb;Px;Pym` (release).
`parseSgrMouse` receives the part **after** `<` (e.g. `'0;5;3'`) plus the final byte (`'M'` or `'m'`).

`Pb` bitmask:
- bits 0–1: button (0=left, 1=middle, 2=right, 3=release-marker)
- bit 2 (0x04): shift
- bit 3 (0x08): alt
- bit 4 (0x10): ctrl
- bit 5 (0x20): motion (mouse-move)
- bit 6 (0x40): scroll wheel (bit 0 then = 0 → up, 1 → down)

- [ ] **Step 1: Write the failing tests**

```ts
// packages/react/src/mouse-parser.test.ts
import { describe, expect, it } from 'vitest';
import { parseSgrMouse } from './mouse-parser.js';

describe('parseSgrMouse', () => {
  it('parses a left-button press', () => {
    const ev = parseSgrMouse('0;5;3', 'M', '\x1b[<0;5;3M');
    expect(ev).toMatchObject({ button: 'left', col: 5, row: 3, pressed: true, ctrl: false, alt: false, shift: false });
    expect(ev?.sequence).toBe('\x1b[<0;5;3M');
  });

  it('parses a left-button release', () => {
    const ev = parseSgrMouse('0;5;3', 'm', '\x1b[<0;5;3m');
    expect(ev).toMatchObject({ button: 'left', col: 5, row: 3, pressed: false });
  });

  it('parses a middle-button press', () => {
    expect(parseSgrMouse('1;5;3', 'M', '')).toMatchObject({ button: 'middle', pressed: true });
  });

  it('parses a right-button press', () => {
    expect(parseSgrMouse('2;5;3', 'M', '')).toMatchObject({ button: 'right', pressed: true });
  });

  it('parses wheel-up (Pb=64)', () => {
    expect(parseSgrMouse('64;5;3', 'M', '')).toMatchObject({ button: 'wheel-up', pressed: true });
  });

  it('parses wheel-down (Pb=65)', () => {
    expect(parseSgrMouse('65;5;3', 'M', '')).toMatchObject({ button: 'wheel-down', pressed: true });
  });

  it('parses mouse-move as button=none (Pb=35: motion bit + bits=3)', () => {
    expect(parseSgrMouse('35;5;3', 'M', '')).toMatchObject({ button: 'none' });
  });

  it('decodes shift modifier (bit 2 = 0x04)', () => {
    expect(parseSgrMouse('4;5;3', 'M', '')).toMatchObject({ shift: true, alt: false, ctrl: false });
  });

  it('decodes alt modifier (bit 3 = 0x08)', () => {
    expect(parseSgrMouse('8;5;3', 'M', '')).toMatchObject({ shift: false, alt: true, ctrl: false });
  });

  it('decodes ctrl modifier (bit 4 = 0x10)', () => {
    expect(parseSgrMouse('16;5;3', 'M', '')).toMatchObject({ shift: false, alt: false, ctrl: true });
  });

  it('decodes combined modifiers (ctrl+shift = 0x14)', () => {
    expect(parseSgrMouse('20;5;3', 'M', '')).toMatchObject({ shift: true, alt: false, ctrl: true });
  });

  it('has a no-op stopPropagation', () => {
    const ev = parseSgrMouse('0;1;1', 'M', '');
    expect(typeof ev?.stopPropagation).toBe('function');
    expect(() => ev?.stopPropagation()).not.toThrow();
  });

  it('returns null for wrong number of params', () => {
    expect(parseSgrMouse('0;5', 'M', '')).toBeNull();
    expect(parseSgrMouse('0;5;3;1', 'M', '')).toBeNull();
  });

  it('returns null for non-numeric params', () => {
    expect(parseSgrMouse('x;5;3', 'M', '')).toBeNull();
    expect(parseSgrMouse('0;y;3', 'M', '')).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
pnpm vitest run packages/react/src/mouse-parser.test.ts
```

Expected: FAIL — `parseSgrMouse` not found.

- [ ] **Step 3: Implement `mouse-parser.ts`**

```ts
// packages/react/src/mouse-parser.ts
import type { MouseButton, MouseEvent } from './mouse-event.js';

export function parseSgrMouse(
  params: string,
  final: string,
  sequence: string,
): MouseEvent | null {
  const parts = params.split(';');
  if (parts.length !== 3) return null;

  const pb  = Number.parseInt(parts[0]!, 10);
  const col = Number.parseInt(parts[1]!, 10);
  const row = Number.parseInt(parts[2]!, 10);
  if (Number.isNaN(pb) || Number.isNaN(col) || Number.isNaN(row)) return null;

  const pressed = final === 'M';
  const shift   = (pb & 0x04) !== 0;
  const alt     = (pb & 0x08) !== 0;
  const ctrl    = (pb & 0x10) !== 0;
  const motion  = (pb & 0x20) !== 0;
  const scroll  = (pb & 0x40) !== 0;
  const btnBits = pb & 0x03;

  let button: MouseButton;
  if (scroll) {
    button = btnBits === 0 ? 'wheel-up' : 'wheel-down';
  } else if (motion && btnBits === 3) {
    button = 'none';
  } else {
    switch (btnBits) {
      case 0:  button = 'left';   break;
      case 1:  button = 'middle'; break;
      case 2:  button = 'right';  break;
      default: button = 'none';
    }
  }

  return {
    col, row, button, pressed, ctrl, alt, shift, sequence,
    stopPropagation: () => {},
  };
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
pnpm vitest run packages/react/src/mouse-parser.test.ts
```

Expected: all 14 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/mouse-parser.ts packages/react/src/mouse-parser.test.ts
git commit -m "feat(react): add SGR mouse parser with tests"
```

---

## Task 3: Extend `ParseResult` + `key-parser.ts` CSI branch

**Files:**
- Modify: `packages/react/src/key-parser.ts`
- Modify (extend): `packages/react/src/key-parser.test.ts`

- [ ] **Step 1: Add mouse-sequence tests to `key-parser.test.ts`**

Append to the end of `packages/react/src/key-parser.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
// (already imported at top of file — add only the new describe block below)

describe('key-parser SGR mouse sequences', () => {
  it('routes a left-click press to mouseEvents, not events', () => {
    const result = parse('\x1b[<0;5;3M');
    expect(result.events).toHaveLength(0);
    expect(result.mouseEvents).toHaveLength(1);
    expect(result.mouseEvents[0]).toMatchObject({ button: 'left', col: 5, row: 3, pressed: true });
  });

  it('routes wheel-up to mouseEvents', () => {
    const { mouseEvents } = parse('\x1b[<64;10;2M');
    expect(mouseEvents[0]).toMatchObject({ button: 'wheel-up' });
  });

  it('parses mouse sequence followed by a regular keypress', () => {
    const { events, mouseEvents } = parse('\x1b[<0;1;1Ma');
    expect(mouseEvents).toHaveLength(1);
    expect(events).toHaveLength(1);
    expect(events[0]?.ch).toBe('a');
  });

  it('drops a malformed SGR sequence without adding a KeyEvent', () => {
    const { events, mouseEvents } = parse('\x1b[<x;y;zM');
    expect(mouseEvents).toHaveLength(0);
    expect(events).toHaveLength(0);
  });

  it('empty mouseEvents on normal input', () => {
    const { mouseEvents } = parse('hello');
    expect(mouseEvents).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
pnpm vitest run packages/react/src/key-parser.test.ts
```

Expected: FAIL — `result.mouseEvents` is undefined.

- [ ] **Step 3: Update `ParseResult` + imports in `key-parser.ts`**

At the top of `packages/react/src/key-parser.ts`, add the import:

```ts
import type { MouseEvent } from './mouse-event.js';
import { parseSgrMouse } from './mouse-parser.js';
```

Change `ParseResult` to:

```ts
export interface ParseResult {
  events: KeyEvent[];
  mouseEvents: MouseEvent[];
  pastes: string[];
  remainder: string;
}
```

- [ ] **Step 4: Initialize `mouseEvents` in `parse()`**

At the top of the `parse` function body, alongside `const events: KeyEvent[] = [];`, add:

```ts
const mouseEvents: MouseEvent[] = [];
```

Add `mouseEvents` to all three `return` statements in `parse()`. There are three early returns (for incomplete sequences) and one final return. Update all four:

```ts
// Early returns — add mouseEvents:
return { events, mouseEvents, pastes, remainder: input.slice(i) };

// Final return:
return { events, mouseEvents, pastes, remainder: '' };
```

- [ ] **Step 5: Route SGR sequences in the CSI branch**

Inside the CSI branch, find the lines:

```ts
const ev = decodeCsi(params, final, sequence);
if (ev) events.push(ev);
else events.push({ ctrl: false, alt: false, shift: false, sequence });
```

Replace with:

```ts
if (params.startsWith('<')) {
  const mev = parseSgrMouse(params.slice(1), final, sequence);
  if (mev) mouseEvents.push(mev);
  // unrecognized SGR sequence: drop silently
} else {
  const ev = decodeCsi(params, final, sequence);
  if (ev) events.push(ev);
  else events.push({ ctrl: false, alt: false, shift: false, sequence });
}
```

- [ ] **Step 6: Run tests — expect PASS**

```bash
pnpm vitest run packages/react/src/key-parser.test.ts
```

Expected: all tests (existing + new) PASS.

- [ ] **Step 7: Full test suite — no regressions**

```bash
pnpm test
```

Expected: all 739+ tests PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/react/src/key-parser.ts packages/react/src/key-parser.test.ts
git commit -m "feat(react): extend ParseResult with mouseEvents; route SGR sequences"
```

---

## Task 4: `mouse-registry.ts` + `mouse-registry.test.ts` (TDD)

**Files:**
- Create: `packages/react/src/mouse-registry.ts`
- Create: `packages/react/src/mouse-registry.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// packages/react/src/mouse-registry.test.ts
import { describe, expect, it } from 'vitest';
import type { ContainerNode } from '@pilates/render';
import { collectHits, mouseRegistry, setMouseHandlers } from './mouse-registry.js';

const noop = (): void => {};

function makeNode(
  layout: { left: number; top: number; width: number; height: number },
  children: ContainerNode[] = [],
): ContainerNode {
  const node = { children } as ContainerNode & {
    _layout?: { left: number; top: number; width: number; height: number };
  };
  node._layout = layout;
  return node;
}

describe('setMouseHandlers', () => {
  it('stores onClick', () => {
    const node = makeNode({ left: 0, top: 0, width: 10, height: 5 });
    setMouseHandlers(node, { onClick: noop });
    expect(mouseRegistry.get(node)?.onClick).toBe(noop);
  });

  it('stores onWheel', () => {
    const node = makeNode({ left: 0, top: 0, width: 10, height: 5 });
    setMouseHandlers(node, { onWheel: noop });
    expect(mouseRegistry.get(node)?.onWheel).toBe(noop);
  });

  it('clears the entry when both handlers are absent', () => {
    const node = makeNode({ left: 0, top: 0, width: 10, height: 5 });
    setMouseHandlers(node, { onClick: noop });
    setMouseHandlers(node, {});
    expect(mouseRegistry.has(node)).toBe(false);
  });

  it('updates handlers in place when called again', () => {
    const fn1 = (): void => {};
    const fn2 = (): void => {};
    const node = makeNode({ left: 0, top: 0, width: 10, height: 5 });
    setMouseHandlers(node, { onClick: fn1 });
    setMouseHandlers(node, { onClick: fn2 });
    expect(mouseRegistry.get(node)?.onClick).toBe(fn2);
  });
});

describe('collectHits', () => {
  it('hits a node whose _layout contains the point', () => {
    const node = makeNode({ left: 0, top: 0, width: 20, height: 10 });
    const hits = collectHits(node, 5, 3);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.node).toBe(node);
    expect(hits[0]!.depth).toBe(0);
  });

  it('misses when point is outside the layout rect', () => {
    const node = makeNode({ left: 0, top: 0, width: 5, height: 5 });
    expect(collectHits(node, 10, 10)).toHaveLength(0);
  });

  it('hits on the inclusive left/top edge', () => {
    const node = makeNode({ left: 2, top: 3, width: 5, height: 4 });
    expect(collectHits(node, 2, 3)).toHaveLength(1);
  });

  it('misses on the exclusive right/bottom edge', () => {
    // left=2, width=5 → right edge is col 7 (exclusive)
    const node = makeNode({ left: 2, top: 3, width: 5, height: 4 });
    expect(collectHits(node, 7, 3)).toHaveLength(0);
    expect(collectHits(node, 2, 7)).toHaveLength(0);
  });

  it('collects parent and child when both contain the point', () => {
    const child = makeNode({ left: 2, top: 2, width: 5, height: 5 });
    const parent = makeNode({ left: 0, top: 0, width: 20, height: 10 }, [child]);
    const hits = collectHits(parent, 3, 3);
    expect(hits).toHaveLength(2);
    const nodes = hits.map((h) => h.node);
    expect(nodes).toContain(parent);
    expect(nodes).toContain(child);
  });

  it('assigns depth=0 to root and depth=1 to direct child', () => {
    const child = makeNode({ left: 0, top: 0, width: 5, height: 5 });
    const parent = makeNode({ left: 0, top: 0, width: 10, height: 10 }, [child]);
    const hits = collectHits(parent, 1, 1);
    const parentHit = hits.find((h) => h.node === parent);
    const childHit = hits.find((h) => h.node === child);
    expect(parentHit?.depth).toBe(0);
    expect(childHit?.depth).toBe(1);
  });

  it('skips nodes without _layout', () => {
    const node = { children: [] } as ContainerNode;
    expect(collectHits(node, 5, 5)).toHaveLength(0);
  });

  it('only hits parent when child does not contain the point', () => {
    const child = makeNode({ left: 10, top: 5, width: 5, height: 3 });
    const parent = makeNode({ left: 0, top: 0, width: 20, height: 10 }, [child]);
    const hits = collectHits(parent, 1, 1);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.node).toBe(parent);
  });

  it('skips text nodes (nodes with a text property)', () => {
    // A TextNode has a `text` property; collectHits should not recurse into it.
    const textNode = { text: 'hello' } as unknown as ContainerNode;
    const parent = makeNode({ left: 0, top: 0, width: 20, height: 10 }, [textNode]);
    // Should not throw even though textNode has no children
    expect(() => collectHits(parent, 5, 5)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
pnpm vitest run packages/react/src/mouse-registry.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `mouse-registry.ts`**

```ts
// packages/react/src/mouse-registry.ts
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
    // Skip TextNode (has a `text` property, no `children` to recurse into).
    if (!('text' in child)) {
      collectHits(child as ContainerNode, col, row, depth + 1, acc);
    }
  }
  return acc;
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
pnpm vitest run packages/react/src/mouse-registry.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/mouse-registry.ts packages/react/src/mouse-registry.test.ts
git commit -m "feat(react): add mouse handler registry and collectHits with tests"
```

---

## Task 5: Mouse subscription infra in `render.tsx` + `hooks.ts` + `useMouse`

**Files:**
- Modify: `packages/react/src/render.tsx`
- Modify: `packages/react/src/hooks.ts`

This task wires raw mouse event dispatch through `StdinProvider` and implements the `useMouse` hook. It does NOT yet add `MouseProvider` or hit-testing (that is Task 7).

- [ ] **Step 1: Add imports to `render.tsx`**

At the top of `render.tsx`, alongside the existing imports, add:

```ts
import type { MouseEvent } from './mouse-event.js';
```

- [ ] **Step 2: Extend `StdinProviderState` in `render.tsx`**

Find the `StdinProviderState` interface and add three fields:

```ts
interface StdinProviderState {
  subscribers: Map<(event: KeyEvent) => void, boolean>;
  pasteSubscribers: Set<(text: string) => void>;
  refcount: number;
  remainder: string;
  rawModeOn: boolean;
  escapeTimer: ReturnType<typeof setTimeout> | null;
  // ↓ new
  mouseSubscribers: Map<(event: MouseEvent) => void, boolean>;
  mouseRefcount: number;
  mouseModeOn: boolean;
}
```

- [ ] **Step 3: Initialize new fields in `stateRef`**

Find:
```ts
const stateRef = useRef<StdinProviderState>({
  subscribers: new Map<(event: KeyEvent) => void, boolean>(),
  pasteSubscribers: new Set<(text: string) => void>(),
  refcount: 0,
  remainder: '',
  rawModeOn: false,
  escapeTimer: null,
});
```

Replace with:
```ts
const stateRef = useRef<StdinProviderState>({
  subscribers: new Map<(event: KeyEvent) => void, boolean>(),
  pasteSubscribers: new Set<(text: string) => void>(),
  refcount: 0,
  remainder: '',
  rawModeOn: false,
  escapeTimer: null,
  mouseSubscribers: new Map<(event: MouseEvent) => void, boolean>(),
  mouseRefcount: 0,
  mouseModeOn: false,
});
```

- [ ] **Step 4: Add SGR mouse mode constants + `ensureMouseMode`/`releaseMouseMode` to `render.tsx`**

After the existing `PASTE_MODE_ENABLE`/`PASTE_MODE_DISABLE`/`ESCAPE_DISAMBIGUATION_MS` constants, add:

```ts
const MOUSE_MODE_ENABLE  = '\x1b[?1006h';
const MOUSE_MODE_DISABLE = '\x1b[?1006l';
```

After the existing `releaseRawMode` function, add:

```ts
function ensureMouseMode(
  stdin: NodeJS.ReadStream,
  stdoutWrite: (s: string) => boolean,
  state: StdinProviderState,
  isRawModeSupported: boolean,
): void {
  if (!state.mouseModeOn) {
    ensureRawMode(stdin, stdoutWrite, state, isRawModeSupported);
    try {
      stdoutWrite(MOUSE_MODE_ENABLE);
      state.mouseModeOn = true;
    } catch {
      /* terminal may not support mouse reporting — swallow */
    }
  }
}

function releaseMouseMode(
  stdoutWrite: (s: string) => boolean,
  state: StdinProviderState,
): void {
  if (state.mouseModeOn) {
    try {
      stdoutWrite(MOUSE_MODE_DISABLE);
    } catch {
      /* swallow */
    }
    state.mouseModeOn = false;
  }
}
```

- [ ] **Step 5: Add `dispatchMouseEvent` function to `render.tsx`**

After `dispatchPaste`, add:

```ts
function dispatchMouseEvent(state: StdinProviderState, event: MouseEvent): void {
  for (const [handler, active] of state.mouseSubscribers) {
    if (!active) continue;
    try {
      handler(event);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`Pilates: useMouse handler threw: ${msg}\n`);
    }
  }
}
```

- [ ] **Step 6: Wire `dispatchMouseEvent` into `onData` in `StdinProvider`**

Inside the `useEffect` in `StdinProvider`, find:

```ts
const { events, pastes, remainder } = parseKeys(combined);
state.remainder = remainder;
for (const event of events) {
  dispatchEvent(state, event);
}
for (const paste of pastes) {
  dispatchPaste(state, paste);
}
```

Replace with:

```ts
const { events, mouseEvents, pastes, remainder } = parseKeys(combined);
state.remainder = remainder;
for (const event of events) {
  dispatchEvent(state, event);
}
for (const mev of mouseEvents) {
  dispatchMouseEvent(state, mev);
}
for (const paste of pastes) {
  dispatchPaste(state, paste);
}
```

- [ ] **Step 7: Add `subscribeMouseEvent` + `setMouseActive` to the `useMemo` value in `StdinProvider`**

Find the `useMemo<StdinHookValue>` block. Add two new entries after the existing `subscribePaste`:

```ts
subscribeMouseEvent: (handler, initialActive = true) => {
  const state = stateRef.current;
  state.mouseSubscribers.set(handler, initialActive);
  if (initialActive) {
    state.mouseRefcount += 1;
    state.refcount += 1; // hold raw mode while mouse mode is active
    ensureMouseMode(stdin, stdoutWrite, state, isRawModeSupported);
  }
  return () => {
    const wasActive = state.mouseSubscribers.get(handler) === true;
    state.mouseSubscribers.delete(handler);
    if (wasActive) {
      state.mouseRefcount -= 1;
      state.refcount -= 1;
      if (state.mouseRefcount === 0) releaseMouseMode(stdoutWrite, state);
      if (state.refcount === 0) releaseRawMode(stdin, stdoutWrite, state, isRawModeSupported);
    }
  };
},
setMouseActive: (handler, active) => {
  const state = stateRef.current;
  const current = state.mouseSubscribers.get(handler);
  if (current === undefined) return;
  if (current === active) return;
  state.mouseSubscribers.set(handler, active);
  if (active) {
    state.mouseRefcount += 1;
    state.refcount += 1;
    ensureMouseMode(stdin, stdoutWrite, state, isRawModeSupported);
  } else {
    state.mouseRefcount -= 1;
    state.refcount -= 1;
    if (state.mouseRefcount === 0) releaseMouseMode(stdoutWrite, state);
    if (state.refcount === 0) releaseRawMode(stdin, stdoutWrite, state, isRawModeSupported);
  }
},
```

- [ ] **Step 8: Also release mouse mode in the cleanup `return` of the `useEffect`**

Find the cleanup in `StdinProvider`'s `useEffect`:

```ts
return () => {
  stdin.off('data', onData);
  if (state.escapeTimer !== null) {
    clearTimeout(state.escapeTimer);
    state.escapeTimer = null;
  }
  if (state.rawModeOn && isRawModeSupported) {
    releaseRawMode(stdin, stdoutWrite, state, isRawModeSupported);
  }
};
```

Replace with:

```ts
return () => {
  stdin.off('data', onData);
  if (state.escapeTimer !== null) {
    clearTimeout(state.escapeTimer);
    state.escapeTimer = null;
  }
  releaseMouseMode(stdoutWrite, state);
  if (state.rawModeOn && isRawModeSupported) {
    releaseRawMode(stdin, stdoutWrite, state, isRawModeSupported);
  }
};
```

- [ ] **Step 9: Extend `StdinHookValue` in `hooks.ts`**

Add two new methods to the `StdinHookValue` interface (after `subscribePaste`):

```ts
/**
 * Subscribe a handler to raw mouse events (all positions + buttons,
 * including moves). Returns an unsubscribe function. Bumps the mouse-mode
 * refcount — enabling SGR mouse reporting on the terminal.
 */
subscribeMouseEvent: (
  handler: (event: MouseEvent) => void,
  initialActive?: boolean,
) => () => void;
/**
 * Mark a previously-subscribed mouse handler as active or inactive.
 * Mirrors `setActive` for keyboard handlers.
 */
setMouseActive: (handler: (event: MouseEvent) => void, active: boolean) => void;
```

Also add the `MouseEvent` import at the top of `hooks.ts`:

```ts
import type { MouseEvent } from './mouse-event.js';
```

- [ ] **Step 10: Add `UseMouseOptions` + `useMouse` to `hooks.ts`**

Add after the existing `useInput`:

```ts
export interface UseMouseOptions {
  /** When false, the handler does not receive mouse events. Defaults to true. */
  isActive?: boolean;
}

export function useMouse(handler: (event: MouseEvent) => void, options: UseMouseOptions = {}): void {
  const v = useContext(StdinContext);
  if (!v)
    throw new PilatesError(
      PilatesErrorCode.HookOutsideRender,
      'useMouse() must be used inside <render>.',
      { meta: { hookName: 'useMouse' } },
    );
  const isActive = options.isActive ?? true;

  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  const dispatchRef = useRef<((event: MouseEvent) => void) | null>(null);
  if (dispatchRef.current === null) {
    dispatchRef.current = (event: MouseEvent) => handlerRef.current(event);
  }

  const initialActiveRef = useRef(isActive);

  useEffect(() => {
    const dispatch = dispatchRef.current;
    if (dispatch === null) return;
    const unsubscribe = v.subscribeMouseEvent(dispatch, initialActiveRef.current);
    return () => {
      unsubscribe();
    };
  }, [v]);

  const setActiveMounted = useRef(false);
  useEffect(() => {
    const dispatch = dispatchRef.current;
    if (dispatch === null) return;
    if (!setActiveMounted.current) {
      setActiveMounted.current = true;
      return;
    }
    v.setMouseActive(dispatch, isActive);
  }, [v, isActive]);
}
```

- [ ] **Step 11: Type-check**

```bash
cd packages/react && pnpm tsc -p tsconfig.typecheck.json --noEmit
```

Expected: no errors.

- [ ] **Step 12: Full test suite — no regressions**

```bash
pnpm test
```

Expected: all existing tests PASS (no test exercises the new code yet).

- [ ] **Step 13: Commit**

```bash
git add packages/react/src/render.tsx packages/react/src/hooks.ts
git commit -m "feat(react): add mouse subscription infra and useMouse hook"
```

---

## Task 6: `useMouse` integration test

**Files:**
- Create: `packages/react/src/use-mouse.test.tsx`

These tests use `fakeStdin.emit` directly (before `sendMouseEvent` is added in Task 8).

- [ ] **Step 1: Write the tests**

```tsx
// packages/react/src/use-mouse.test.tsx
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { Box } from './components.js';
import { useMouse } from './hooks.js';
import type { MouseEvent } from './mouse-event.js';
import { mountWithInput } from './test-utils.js';

describe('useMouse', () => {
  it('receives a mouse event emitted to stdin', () => {
    const received: MouseEvent[] = [];
    function App() {
      useMouse((e) => { received.push(e); });
      return createElement(Box, { width: 5, height: 5 });
    }
    const { fakeStdin } = mountWithInput(
      null,
      () => createElement(App),
      { width: 40, height: 20 },
    );
    // Left press at col=1, row=1 (SGR: \x1b[<0;1;1M)
    fakeStdin.emit('data', '\x1b[<0;1;1M');
    expect(received).toHaveLength(1);
    expect(received[0]!.button).toBe('left');
    expect(received[0]!.col).toBe(1);
    expect(received[0]!.row).toBe(1);
    expect(received[0]!.pressed).toBe(true);
  });

  it('receives events at positions outside any rendered box', () => {
    const received: MouseEvent[] = [];
    function App() {
      useMouse((e) => { received.push(e); });
      return createElement(Box, { width: 5, height: 5 });
    }
    const { fakeStdin } = mountWithInput(
      null,
      () => createElement(App),
      { width: 40, height: 20 },
    );
    // Far outside any box
    fakeStdin.emit('data', '\x1b[<0;99;99M');
    expect(received).toHaveLength(1);
  });

  it('receives wheel-up events', () => {
    const received: MouseEvent[] = [];
    function App() {
      useMouse((e) => { received.push(e); });
      return createElement(Box, { width: 5, height: 5 });
    }
    const { fakeStdin } = mountWithInput(
      null,
      () => createElement(App),
      { width: 40, height: 20 },
    );
    fakeStdin.emit('data', '\x1b[<64;1;1M');
    expect(received[0]!.button).toBe('wheel-up');
  });

  it('stops receiving when isActive becomes false', () => {
    const received: MouseEvent[] = [];
    function App({ active }: { active: boolean }) {
      useMouse((e) => { received.push(e); }, { isActive: active });
      return createElement(Box, { width: 5, height: 5 });
    }
    const { fakeStdin, setState } = mountWithInput(
      true as boolean,
      (active) => createElement(App, { active }),
      { width: 40, height: 20 },
    );
    setState(false);
    fakeStdin.emit('data', '\x1b[<0;1;1M');
    expect(received).toHaveLength(0);
  });

  it('resumes receiving when isActive becomes true again', () => {
    const received: MouseEvent[] = [];
    function App({ active }: { active: boolean }) {
      useMouse((e) => { received.push(e); }, { isActive: active });
      return createElement(Box, { width: 5, height: 5 });
    }
    const { fakeStdin, setState } = mountWithInput(
      true as boolean,
      (active) => createElement(App, { active }),
      { width: 40, height: 20 },
    );
    setState(false);
    setState(true);
    fakeStdin.emit('data', '\x1b[<0;1;1M');
    expect(received).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests — expect PASS**

```bash
pnpm vitest run packages/react/src/use-mouse.test.tsx
```

Expected: all 5 tests PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/react/src/use-mouse.test.tsx
git commit -m "test(react): add useMouse integration tests"
```

---

## Task 7: `MouseProvider` + `hitTestAndBubble` + provider hierarchy

**Files:**
- Modify: `packages/react/src/render.tsx`

- [ ] **Step 1: Add imports to `render.tsx`**

Add the following imports at the top of `render.tsx` (alongside existing imports):

```ts
import { collectHits, mouseRegistry } from './mouse-registry.js';
import type { HitNode } from './mouse-registry.js';
```

- [ ] **Step 2: Add `MouseContext` + `MouseProvider` to `render.tsx`**

Add after the `flushHeldEscape` function (before `ensureRawMode`) or after all the helper functions, before `StdinProvider`:

```ts
interface MouseContextValue {
  hitTestAndBubble: (event: MouseEvent) => void;
}

const MouseContext = createContext<MouseContextValue | null>(null);

function MouseProvider({
  container,
  children,
}: {
  container: RootContainer;
  children?: ReactNode;
}) {
  const hitRef = useRef<((event: MouseEvent) => void) | null>(null);
  if (hitRef.current === null) {
    hitRef.current = (event: MouseEvent): void => {
      const hits: HitNode[] = collectHits(
        container.root,
        event.col - 1,
        event.row - 1,
      );
      hits.sort((a, b) => b.depth - a.depth);
      let stopped = false;
      const ev: MouseEvent = {
        ...event,
        stopPropagation: () => { stopped = true; },
      };
      for (const { node } of hits) {
        if (stopped) break;
        const handlers = mouseRegistry.get(node);
        if (handlers === undefined) continue;
        const isWheel = event.button === 'wheel-up' || event.button === 'wheel-down';
        if (isWheel) {
          handlers.onWheel?.(ev);
        } else if (event.pressed) {
          handlers.onClick?.(ev);
        }
      }
    };
  }
  const value = useMemo<MouseContextValue>(
    () => ({ hitTestAndBubble: hitRef.current! }),
    [],
  );
  return createElement(MouseContext.Provider, { value }, children);
}
```

- [ ] **Step 3: Wire `hitTestAndBubble` into `StdinProvider.onData`**

Inside `StdinProvider`, add a ref to capture the latest `MouseContext` value (same pattern as `latestWriteRef`):

```ts
const mouseCtx = useContext(MouseContext);
const mouseCtxRef = useRef(mouseCtx);
mouseCtxRef.current = mouseCtx;
```

Then in the `onData` handler, change:

```ts
for (const mev of mouseEvents) {
  dispatchMouseEvent(state, mev);
}
```

to:

```ts
for (const mev of mouseEvents) {
  dispatchMouseEvent(state, mev);
  mouseCtxRef.current?.hitTestAndBubble(mev);
}
```

- [ ] **Step 4: Insert `MouseProvider` into the provider hierarchy in `render()`**

Find the `wrapped` element construction in `render()`:

```ts
createElement(
  ResizeBridge,
  { rootNode, container },
  createElement(StdinProvider, { stdin }, stdinChildren),
),
```

Replace with:

```ts
createElement(
  ResizeBridge,
  { rootNode, container },
  createElement(
    MouseProvider,
    { container },
    createElement(StdinProvider, { stdin }, stdinChildren),
  ),
),
```

- [ ] **Step 5: Export `MouseProvider` at the bottom of `render.tsx`**

Add to the existing export at the bottom:

```ts
export { StdinProvider, MouseProvider };
```

- [ ] **Step 6: Type-check**

```bash
cd packages/react && pnpm tsc -p tsconfig.typecheck.json --noEmit
```

Expected: no errors.

- [ ] **Step 7: Full suite — no regressions**

```bash
pnpm test
```

Expected: all tests PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/react/src/render.tsx
git commit -m "feat(react): add MouseProvider and hitTestAndBubble dispatch"
```

---

## Task 8: `test-utils.ts` — `MouseProvider` + `sendMouseEvent`

**Files:**
- Modify: `packages/react/src/test-utils.ts`

- [ ] **Step 1: Add `MouseProvider` import to `test-utils.ts`**

Find the existing import from `render.js`:

```ts
import { StdinProvider } from './render.js';
```

Replace with:

```ts
import { MouseProvider, StdinProvider } from './render.js';
```

Also add at the top imports:

```ts
import type { MouseButton } from './mouse-event.js';
```

- [ ] **Step 2: Add `encodeSgrMouseBytes` helper function**

Add this function after the `eventToBytes` function (before `InputMountHandle`):

```ts
function encodeSgrMouseBytes(opts: {
  button: MouseButton;
  col: number;
  row: number;
  pressed?: boolean;
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
}): string {
  let pb = 0;
  switch (opts.button) {
    case 'left':       pb = 0;  break;
    case 'middle':     pb = 1;  break;
    case 'right':      pb = 2;  break;
    case 'wheel-up':   pb = 64; break;
    case 'wheel-down': pb = 65; break;
    case 'none':       pb = 35; break; // motion bit (0x20) | bits=3
  }
  if (opts.shift === true) pb |= 0x04;
  if (opts.alt   === true) pb |= 0x08;
  if (opts.ctrl  === true) pb |= 0x10;
  const final = (opts.pressed ?? true) ? 'M' : 'm';
  return `\x1b[<${pb};${opts.col};${opts.row}${final}`;
}
```

- [ ] **Step 3: Add `sendMouseEvent` to `InputMountHandle`**

Find the `InputMountHandle` interface and add the new method:

```ts
export interface InputMountHandle<T> extends MountHandle<T> {
  press(event: Partial<KeyEvent>): void;
  pressKey(name: KeyName): void;
  pressChar(ch: string): void;
  pressCtrl(ch: string): void;
  fakeStdin: FakeStdin;
  flush(): void;
  /** Dispatch a synthetic mouse event through the real SGR parser chain. */
  sendMouseEvent(opts: {
    button: MouseButton;
    col: number;
    row: number;
    pressed?: boolean;
    ctrl?: boolean;
    alt?: boolean;
    shift?: boolean;
  }): void;
}
```

- [ ] **Step 4: Implement `sendMouseEvent` in `mountWithInput`**

In the `return` object of `mountWithInput`, add after `flush`:

```ts
sendMouseEvent: (opts) => {
  withAct(() => {
    const bytes = encodeSgrMouseBytes(opts);
    fakeStdin.emit('data', bytes);
    sync.flushSyncWork();
  });
},
```

- [ ] **Step 5: Add `MouseProvider` to the provider hierarchy in `mountWithInput`**

Find the `Wrapper` function inside `mountWithInput`. Replace the `StdinProvider` element with a `MouseProvider` wrapping it:

```ts
createElement(
  StdinProvider,
  { stdin: fakeStdin as unknown as NodeJS.ReadStream },
  disableFocus ? innerEl : createElement(FocusProvider, null, innerEl),
),
```

Replace with:

```ts
createElement(
  MouseProvider,
  { container },
  createElement(
    StdinProvider,
    { stdin: fakeStdin as unknown as NodeJS.ReadStream },
    disableFocus ? innerEl : createElement(FocusProvider, null, innerEl),
  ),
),
```

(`container` is the `RootContainer` local variable already in scope inside `mountWithInput`.)

- [ ] **Step 6: Type-check**

```bash
cd packages/react && pnpm tsc -p tsconfig.typecheck.json --noEmit
```

Expected: no errors.

- [ ] **Step 7: Full suite — no regressions**

```bash
pnpm test
```

Expected: all tests PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/react/src/test-utils.ts
git commit -m "feat(react): add MouseProvider to mountWithInput and sendMouseEvent helper"
```

---

## Task 9: `host-config.ts` + `BoxProps` in `components.tsx`

**Files:**
- Modify: `packages/react/src/host-config.ts`
- Modify: `packages/react/src/components.tsx`

- [ ] **Step 1: Add imports to `host-config.ts`**

At the top of `host-config.ts`, add:

```ts
import type { ContainerNode } from '@pilates/render';
import { setMouseHandlers } from './mouse-registry.js';
```

(`ContainerNode` is already imported transitively via reconciler types; add the explicit import if it's not present.)

- [ ] **Step 2: Strip mouse props and call `setMouseHandlers` in `createInstance`**

Find the `pilates-box` branch in `createInstance`:

```ts
if (type === 'pilates-box') {
  const { children: _ignored, ...rest } = cleaned;
  return { kind: 'box', node: { ...rest, children: [] } as RenderNode } as BoxInstance;
}
```

Replace with:

```ts
if (type === 'pilates-box') {
  const { children: _c, onClick: _oc, onWheel: _ow, ...rest } = cleaned;
  const instance: BoxInstance = {
    kind: 'box',
    node: { ...rest, children: [] } as RenderNode,
  };
  setMouseHandlers(instance.node as ContainerNode, cleaned);
  return instance;
}
```

- [ ] **Step 3: Strip mouse props and call `setMouseHandlers` in `commitUpdate`**

Find the `commitUpdate` handler. It currently has:

```ts
const cleaned = defined(newProps);
const { children: _ignored, ...rest } = cleaned;
const target = instance.node as Record<string, unknown>;
const preserved = instance.kind === 'box' ? 'children' : 'text';
for (const k of Object.keys(target)) {
  if (k !== preserved) delete target[k];
}
for (const k of Object.keys(rest)) {
  target[k] = rest[k];
}
```

Replace with:

```ts
const cleaned = defined(newProps);
const { children: _c, onClick: _oc, onWheel: _ow, ...rest } = cleaned;
const target = instance.node as Record<string, unknown>;
const preserved = instance.kind === 'box' ? 'children' : 'text';
for (const k of Object.keys(target)) {
  if (k !== preserved) delete target[k];
}
for (const k of Object.keys(rest)) {
  target[k] = rest[k];
}
if (instance.kind === 'box') {
  setMouseHandlers(instance.node as ContainerNode, cleaned);
}
```

- [ ] **Step 4: Add `onClick` + `onWheel` to `BoxProps` in `components.tsx`**

At the top of `components.tsx`, add the import:

```ts
import type { MouseEvent } from './mouse-event.js';
```

Find the `BoxProps` type:

```ts
export type BoxProps = LayoutProps &
  BorderProps & {
    children?: ReactNode;
    ref?: Ref<unknown>;
  };
```

Replace with:

```ts
export type BoxProps = LayoutProps &
  BorderProps & {
    children?: ReactNode;
    ref?: Ref<unknown>;
    onClick?: (event: MouseEvent) => void;
    onWheel?: (event: MouseEvent) => void;
  };
```

Also update the JSX intrinsic declaration:

```ts
'pilates-box': BoxProps & { children?: ReactNode; ref?: Ref<unknown> };
```

(No change needed — `BoxProps` already includes the new props and the intrinsic declaration references `BoxProps`.)

- [ ] **Step 5: Type-check**

```bash
cd packages/react && pnpm tsc -p tsconfig.typecheck.json --noEmit
```

Expected: no errors.

- [ ] **Step 6: Full suite — no regressions**

```bash
pnpm test
```

Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/react/src/host-config.ts packages/react/src/components.tsx
git commit -m "feat(react): add onClick/onWheel to BoxProps; wire mouse handlers in host-config"
```

---

## Task 10: `mouse-dispatch.test.tsx` — click/wheel/bubbling integration tests

**Files:**
- Create: `packages/react/src/mouse-dispatch.test.tsx`

These tests verify the full pipeline: `sendMouseEvent` → parser → `hitTestAndBubble` → `WeakMap` lookup → bubbling.

**Layout note:** In these tests, a `<Box width={W} height={H}>` mounted at the root occupies `_layout = { left: 0, top: 0, width: W, height: H }`. A child `<Box>` that fills its parent will also start at `(0, 0)` in absolute terminal coords. Column 1, row 1 (1-based) maps to layout coords `(0, 0)`, which is inside a box at `left=0, top=0, width≥1, height≥1`.

- [ ] **Step 1: Write the tests**

```tsx
// packages/react/src/mouse-dispatch.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { Box } from './components.js';
import type { MouseEvent } from './mouse-event.js';
import { mountWithInput } from './test-utils.js';

describe('onClick on <Box>', () => {
  it('fires when the box is clicked', () => {
    const handler = vi.fn();
    const { sendMouseEvent } = mountWithInput(
      null,
      () => createElement(Box, { onClick: handler, width: 20, height: 10 }),
      { width: 40, height: 20 },
    );
    sendMouseEvent({ button: 'left', col: 1, row: 1 });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]![0].button).toBe('left');
    expect(handler.mock.calls[0]![0].col).toBe(1);
  });

  it('does not fire when click is outside the box', () => {
    const handler = vi.fn();
    const { sendMouseEvent } = mountWithInput(
      null,
      () => createElement(Box, { onClick: handler, width: 5, height: 5 }),
      { width: 40, height: 20 },
    );
    // Box occupies cols 1–5, rows 1–5; click at col=10 is outside
    sendMouseEvent({ button: 'left', col: 10, row: 1 });
    expect(handler).not.toHaveBeenCalled();
  });

  it('does not fire on release events (pressed=false)', () => {
    const handler = vi.fn();
    const { sendMouseEvent } = mountWithInput(
      null,
      () => createElement(Box, { onClick: handler, width: 20, height: 10 }),
      { width: 40, height: 20 },
    );
    sendMouseEvent({ button: 'left', col: 1, row: 1, pressed: false });
    expect(handler).not.toHaveBeenCalled();
  });

  it('passes a stopPropagation method on the event', () => {
    const handler = vi.fn((e: MouseEvent) => {
      expect(typeof e.stopPropagation).toBe('function');
    });
    const { sendMouseEvent } = mountWithInput(
      null,
      () => createElement(Box, { onClick: handler, width: 20, height: 10 }),
      { width: 40, height: 20 },
    );
    sendMouseEvent({ button: 'left', col: 1, row: 1 });
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe('onClick bubbling', () => {
  it('fires both inner and outer handlers', () => {
    const outer = vi.fn();
    const inner = vi.fn();
    const { sendMouseEvent } = mountWithInput(
      null,
      () =>
        createElement(
          Box,
          { onClick: outer, width: 20, height: 10 },
          createElement(Box, { onClick: inner, width: 10, height: 5 }),
        ),
      { width: 40, height: 20 },
    );
    sendMouseEvent({ button: 'left', col: 1, row: 1 });
    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).toHaveBeenCalledTimes(1);
  });

  it('inner handler fires before outer (deepest-first bubbling)', () => {
    const order: string[] = [];
    const { sendMouseEvent } = mountWithInput(
      null,
      () =>
        createElement(
          Box,
          { onClick: () => order.push('outer'), width: 20, height: 10 },
          createElement(Box, { onClick: () => order.push('inner'), width: 10, height: 5 }),
        ),
      { width: 40, height: 20 },
    );
    sendMouseEvent({ button: 'left', col: 1, row: 1 });
    expect(order).toEqual(['inner', 'outer']);
  });

  it('stopPropagation prevents outer from firing', () => {
    const outer = vi.fn();
    const inner = vi.fn((e: MouseEvent) => e.stopPropagation());
    const { sendMouseEvent } = mountWithInput(
      null,
      () =>
        createElement(
          Box,
          { onClick: outer, width: 20, height: 10 },
          createElement(Box, { onClick: inner, width: 10, height: 5 }),
        ),
      { width: 40, height: 20 },
    );
    sendMouseEvent({ button: 'left', col: 1, row: 1 });
    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
  });
});

describe('onWheel on <Box>', () => {
  it('fires onWheel for wheel-up', () => {
    const handler = vi.fn();
    const { sendMouseEvent } = mountWithInput(
      null,
      () => createElement(Box, { onWheel: handler, width: 20, height: 10 }),
      { width: 40, height: 20 },
    );
    sendMouseEvent({ button: 'wheel-up', col: 1, row: 1 });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]![0].button).toBe('wheel-up');
  });

  it('fires onWheel for wheel-down', () => {
    const handler = vi.fn();
    const { sendMouseEvent } = mountWithInput(
      null,
      () => createElement(Box, { onWheel: handler, width: 20, height: 10 }),
      { width: 40, height: 20 },
    );
    sendMouseEvent({ button: 'wheel-down', col: 1, row: 1 });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]![0].button).toBe('wheel-down');
  });

  it('does not fire onClick for a wheel event', () => {
    const clickHandler = vi.fn();
    const wheelHandler = vi.fn();
    const { sendMouseEvent } = mountWithInput(
      null,
      () => createElement(Box, { onClick: clickHandler, onWheel: wheelHandler, width: 20, height: 10 }),
      { width: 40, height: 20 },
    );
    sendMouseEvent({ button: 'wheel-up', col: 1, row: 1 });
    expect(clickHandler).not.toHaveBeenCalled();
    expect(wheelHandler).toHaveBeenCalledTimes(1);
  });

  it('does not fire onClick for a left-click when only onWheel is set', () => {
    const wheelHandler = vi.fn();
    const { sendMouseEvent } = mountWithInput(
      null,
      () => createElement(Box, { onWheel: wheelHandler, width: 20, height: 10 }),
      { width: 40, height: 20 },
    );
    sendMouseEvent({ button: 'left', col: 1, row: 1 });
    expect(wheelHandler).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests — expect PASS**

```bash
pnpm vitest run packages/react/src/mouse-dispatch.test.tsx
```

Expected: all tests PASS.

- [ ] **Step 3: Full suite**

```bash
pnpm test
```

Expected: all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/react/src/mouse-dispatch.test.tsx
git commit -m "test(react): add mouse dispatch integration tests (click, wheel, bubbling)"
```

---

## Task 11: `ScrollView` wheel wiring + `scroll-view-mouse.test.tsx`

**Files:**
- Modify: `packages/react/src/scroll-view.tsx`
- Create: `packages/react/src/scroll-view-mouse.test.tsx`

- [ ] **Step 1: Write the failing tests first**

```tsx
// packages/react/src/scroll-view-mouse.test.tsx
import { describe, expect, it } from 'vitest';
import { createElement, useRef } from 'react';
import type { ScrollViewHandle } from './scroll-view.js';
import { ScrollView } from './scroll-view.js';
import { Box } from './components.js';
import { Text } from './components.js';
import { mountWithInput } from './test-utils.js';

describe('ScrollView wheel scrolling', () => {
  it('scrolls down on wheel-down event over the ScrollView', () => {
    let handle: ScrollViewHandle | null = null;
    const { sendMouseEvent, flush } = mountWithInput(
      null,
      () => {
        const ref = useRef<ScrollViewHandle>(null);
        if (ref.current !== null && handle === null) handle = ref.current;
        return createElement(
          ScrollView,
          { ref, height: 3, scrollEnabled: false },
          createElement(Box, { height: 1 }, createElement(Text, null, 'line1')),
          createElement(Box, { height: 1 }, createElement(Text, null, 'line2')),
          createElement(Box, { height: 1 }, createElement(Text, null, 'line3')),
          createElement(Box, { height: 1 }, createElement(Text, null, 'line4')),
          createElement(Box, { height: 1 }, createElement(Text, null, 'line5')),
        );
      },
      { width: 20, height: 5 },
    );
    flush();
    handle = handle!;
    expect(handle.getScrollOffset()).toBe(0);
    sendMouseEvent({ button: 'wheel-down', col: 1, row: 1 });
    flush();
    expect(handle.getScrollOffset()).toBe(1);
  });

  it('scrolls up on wheel-up event', () => {
    let handle: ScrollViewHandle | null = null;
    const { sendMouseEvent, flush } = mountWithInput(
      null,
      () => {
        const ref = useRef<ScrollViewHandle>(null);
        if (ref.current !== null && handle === null) handle = ref.current;
        return createElement(
          ScrollView,
          { ref, height: 3, scrollEnabled: false },
          createElement(Box, { height: 1 }, createElement(Text, null, 'line1')),
          createElement(Box, { height: 1 }, createElement(Text, null, 'line2')),
          createElement(Box, { height: 1 }, createElement(Text, null, 'line3')),
          createElement(Box, { height: 1 }, createElement(Text, null, 'line4')),
          createElement(Box, { height: 1 }, createElement(Text, null, 'line5')),
        );
      },
      { width: 20, height: 5 },
    );
    flush();
    handle = handle!;
    handle.scrollTo(2);
    flush();
    sendMouseEvent({ button: 'wheel-up', col: 1, row: 1 });
    flush();
    expect(handle.getScrollOffset()).toBe(1);
  });

  it('does not scroll when scrollEnabled is false and no onWheel', () => {
    // Baseline: scrollEnabled:false disables keyboard nav. But wheel is independent.
    // This test just confirms the above two tests aren't accidentally passing.
    let handle: ScrollViewHandle | null = null;
    const { flush } = mountWithInput(
      null,
      () => {
        const ref = useRef<ScrollViewHandle>(null);
        if (ref.current !== null && handle === null) handle = ref.current;
        return createElement(
          ScrollView,
          { ref, height: 3, scrollEnabled: false },
          createElement(Box, { height: 1 }, createElement(Text, null, 'line1')),
          createElement(Box, { height: 1 }, createElement(Text, null, 'line2')),
          createElement(Box, { height: 1 }, createElement(Text, null, 'line3')),
          createElement(Box, { height: 1 }, createElement(Text, null, 'line4')),
        );
      },
      { width: 20, height: 5 },
    );
    flush();
    expect(handle!.getScrollOffset()).toBe(0);
  });

  it('nested ScrollViews: inner consumes wheel, outer does not scroll', () => {
    let outerHandle: ScrollViewHandle | null = null;
    let innerHandle: ScrollViewHandle | null = null;
    const { sendMouseEvent, flush } = mountWithInput(
      null,
      () => {
        const outerRef = useRef<ScrollViewHandle>(null);
        const innerRef = useRef<ScrollViewHandle>(null);
        if (outerRef.current && outerHandle === null) outerHandle = outerRef.current;
        if (innerRef.current && innerHandle === null) innerHandle = innerRef.current;
        return createElement(
          ScrollView,
          { ref: outerRef, height: 6, scrollEnabled: false },
          createElement(Box, { height: 1 }, createElement(Text, null, 'outer1')),
          createElement(Box, { height: 1 }, createElement(Text, null, 'outer2')),
          createElement(
            ScrollView,
            { ref: innerRef, height: 2, scrollEnabled: false },
            createElement(Box, { height: 1 }, createElement(Text, null, 'inner1')),
            createElement(Box, { height: 1 }, createElement(Text, null, 'inner2')),
            createElement(Box, { height: 1 }, createElement(Text, null, 'inner3')),
          ),
        );
      },
      { width: 20, height: 10 },
    );
    flush();
    outerHandle = outerHandle!;
    innerHandle = innerHandle!;
    // Click inside inner scroll view area
    sendMouseEvent({ button: 'wheel-down', col: 1, row: 3 });
    flush();
    expect(innerHandle.getScrollOffset()).toBe(1);
    expect(outerHandle.getScrollOffset()).toBe(0);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
pnpm vitest run packages/react/src/scroll-view-mouse.test.tsx
```

Expected: FAIL — wheel events do nothing yet.

- [ ] **Step 3: Add `onWheel` to `ScrollView`'s inner `<Box>`**

In `packages/react/src/scroll-view.tsx`, add `import type { MouseEvent } from './mouse-event.js';` to the imports.

Find the return statement's `<Box>` opening element (the one with `ref={boxRef}`). It currently looks like:

```tsx
<Box
  ref={boxRef}
  {...(width !== undefined ? { width } : {})}
  {...(height !== undefined ? { height } : {})}
  flexDirection={isVertical ? 'column' : 'row'}
  {...axisOverflow}
  {...offsetProp}
>
```

Add an `onWheel` prop:

```tsx
<Box
  ref={boxRef}
  {...(width !== undefined ? { width } : {})}
  {...(height !== undefined ? { height } : {})}
  flexDirection={isVertical ? 'column' : 'row'}
  {...axisOverflow}
  {...offsetProp}
  onWheel={(e: MouseEvent) => {
    if (!enabled) return;
    e.stopPropagation();
    if (e.button === 'wheel-up') setOffset(offsetRef.current - 1);
    if (e.button === 'wheel-down') setOffset(offsetRef.current + 1);
  }}
>
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
pnpm vitest run packages/react/src/scroll-view-mouse.test.tsx
```

Expected: all tests PASS.

- [ ] **Step 5: Full suite**

```bash
pnpm test
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/react/src/scroll-view.tsx packages/react/src/scroll-view-mouse.test.tsx
git commit -m "feat(react): wire ScrollView wheel scrolling with stopPropagation isolation"
```

---

## Task 12: `index.ts` — export public mouse API

**Files:**
- Modify: `packages/react/src/index.ts`

- [ ] **Step 1: Add mouse exports to `index.ts`**

Find the `// Hooks` section and add `useMouse` to the named exports:

```ts
export { useApp, useInput, useMouse, usePaste, useStdout, useStderr, useWindowSize } from './hooks.js';
```

Add `UseMouseOptions` and `MouseEvent`/`MouseButton` to the type exports:

```ts
export type {
  AppHookValue,
  KeyEvent,
  KeyName,
  MouseEvent,
  MouseButton,
  StderrHookValue,
  StdoutHookValue,
  UseInputOptions,
  UseMouseOptions,
} from './hooks.js';
```

Wait — `MouseEvent` and `MouseButton` are defined in `mouse-event.ts`, not `hooks.ts`. We need to re-export them from `hooks.ts` or directly from `index.ts`. The cleaner approach is to re-export directly from `index.ts`:

Add a new export section after the hooks section:

```ts
// Mouse support
export { useMouse } from './hooks.js';
export type { UseMouseOptions } from './hooks.js';
export type { MouseButton, MouseEvent } from './mouse-event.js';
```

And remove `useMouse`/`UseMouseOptions` from the combined hooks export if you prefer keeping them grouped — either way is fine as long as there are no duplicate exports.

Simplest: add `useMouse` to the existing hooks export line, add `UseMouseOptions` to the type export, and add a separate two-line block for `mouse-event.ts` types:

```ts
// in the hooks export:
export { useApp, useInput, useMouse, usePaste, useStdout, useStderr, useWindowSize } from './hooks.js';

// in the hooks type export, add:
UseMouseOptions,

// new block:
export type { MouseButton, MouseEvent } from './mouse-event.js';
```

- [ ] **Step 2: Type-check**

```bash
cd packages/react && pnpm tsc -p tsconfig.typecheck.json --noEmit
```

Expected: no errors.

- [ ] **Step 3: Verify exports via `index.test.ts`**

```bash
pnpm vitest run packages/react/src/index.test.ts
```

Expected: PASS (no new assertions needed; the type-check is the main guard here).

- [ ] **Step 4: Full suite — final green**

```bash
pnpm test
```

Expected: all tests PASS (739+ including new mouse tests).

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/index.ts
git commit -m "feat(react): export useMouse, MouseEvent, MouseButton, UseMouseOptions from index"
```

---

## Self-Review Checklist (run before handing off)

After completing all tasks, verify:

```bash
pnpm test           # all tests green
cd packages/react && pnpm tsc -p tsconfig.typecheck.json --noEmit  # no type errors
```

Spec coverage check:
- [x] `onClick` / `onWheel` on `<Box>` — Tasks 9 + 10
- [x] Bubbling deepest-first — Task 10
- [x] `stopPropagation` — Task 10
- [x] `useMouse` raw hook — Tasks 5 + 6
- [x] SGR mouse parsing — Tasks 2 + 3
- [x] Mouse mode ref-counted (enable on first subscriber, disable on last) — Task 5
- [x] Mouse mode disabled on cleanup — Task 5
- [x] Hit-test via `_layout` — Task 4
- [x] `ScrollView` wheel scrolling — Task 11
- [x] Nested `ScrollView` isolation via `stopPropagation` — Task 11
- [x] `sendMouseEvent` in test-utils — Task 8
- [x] Public exports — Task 12
- [x] Wheel events do NOT fire `onClick` — Task 10
- [x] Release events (`pressed: false`) do NOT fire `onClick` — Task 10
