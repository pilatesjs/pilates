# Mouse Support Design

**Date:** 2026-05-07  
**Branch:** mouse-support  
**Status:** Approved — ready for implementation plan

---

## Overview

Add terminal mouse support to `@pilates/react`. When enabled, the terminal reports mouse events as SGR ANSI sequences on stdin. The framework parses them, hit-tests reported (col, row) against committed node layouts, and dispatches `onClick` / `onWheel` events to matching `<Box>` components with bubbling. A `useMouse` hook exposes raw mouse events for custom widget logic. `ScrollView` is wired to scroll on wheel events automatically.

### Scope

- `onClick` and `onWheel` props on `<Box>`
- Bubbling from deepest matching box up to ancestors, with `stopPropagation`
- `useMouse(handler)` hook for raw mouse events (all positions + buttons)
- `ScrollView` wheel scrolling (scoped to the scroll view's bounding box)
- Mouse mode ref-counted alongside raw mode — zero overhead for keyboard-only apps
- `sendMouseEvent` in test-utils for integration testing
- **Out of scope (follow-up):** `onMouseEnter` / `onMouseLeave` hover tracking

---

## Architecture

### New files

| File | Purpose |
|---|---|
| `packages/react/src/mouse-event.ts` | `MouseEvent` type, `MouseButton` enum |
| `packages/react/src/mouse-registry.ts` | `WeakMap<ContainerNode, MouseHandlers>`, `collectHits`, `setMouseHandlers` |
| `packages/react/src/mouse-parser.ts` | SGR byte sequence → `MouseEvent` |

### Modified files

| File | Change |
|---|---|
| `packages/react/src/key-parser.ts` | Detect SGR mouse sequences in CSI branch; add `mouseEvents` to `ParseResult` |
| `packages/react/src/hooks.ts` | Add `subscribeMouseEvent` / `setMouseActive` to `StdinHookValue`; export `useMouse` |
| `packages/react/src/render.tsx` | Insert `MouseProvider` between `ResizeBridge` and `StdinProvider`; pass `container` |
| `packages/react/src/host-config.ts` | Call `setMouseHandlers` in `createInstance` / `commitUpdate`; strip mouse props from render node |
| `packages/react/src/components.tsx` | Add `onClick`, `onWheel` to `BoxProps` and JSX intrinsic |
| `packages/react/src/scroll-view.tsx` | Add `onWheel` prop to inner `<Box>` with `stopPropagation` |
| `packages/react/src/test-utils.ts` | Add `sendMouseEvent` to `MountWithInputHandle` |

### Provider hierarchy (`render.tsx`)

```
AppContext.Provider
  StdoutProvider
    ResizeBridge { rootNode, container }
      MouseProvider { container }          ← new
        StdinProvider { stdin }
          FocusProvider
            [app]
```

### Data flow

```
stdin bytes
  │
  ▼
StdinProvider onData
  └─ parseKeys(combined) → ParseResult { events, mouseEvents, pastes, remainder }
       ├─ events[]      → dispatchEvent()       → useInput subscribers
       ├─ mouseEvents[] → dispatchMouseEvent()
       │                    ├─ useMouse subscribers (raw, unfiltered)
       │                    └─ MouseContext.hitTestAndBubble(event)
       │                         └─ collectHits(container.root) → WeakMap lookup → bubble
       └─ pastes[]      → dispatchPaste()        → usePaste subscribers
```

---

## `MouseEvent` type (`mouse-event.ts`)

```ts
export type MouseButton =
  | 'left' | 'middle' | 'right'
  | 'wheel-up' | 'wheel-down'
  | 'none';   // mouse-move, no button

export interface MouseEvent {
  col: number;       // 1-based terminal column
  row: number;       // 1-based terminal row
  button: MouseButton;
  pressed: boolean;  // true = press / wheel tick, false = release
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  sequence: string;  // raw SGR bytes
  stopPropagation: () => void;  // call to halt bubbling
}
```

Wheel events always have `pressed: true` (terminals emit no wheel-release). `button: 'none'` covers move events — dispatched to raw `useMouse` subscribers but not to the hit-test/bubble path.

---

## SGR Mouse Parsing (`mouse-parser.ts`)

Terminal SGR format: `\x1b[<Pb;Px;PyM` (press) or `\x1b[<Pb;Px;Pym` (release).

`Pb` bitmask:
```
bits 0–1 : button  (0=left, 1=middle, 2=right, 3=release/move)
bit  2   : shift
bit  3   : alt
bit  4   : ctrl
bit  5   : motion  (mouse-move event)
bit  6   : scroll  (bit 0 then = 0 up, 1 down)
```

### `key-parser.ts` change

The existing CSI branch already delimits sequences correctly. Extend `decodeCsi` to detect the `<` prefix in `params` and delegate to `parseSgrMouse()` in `mouse-parser.ts`, returning a `MouseEvent`. `ParseResult` gains:

```ts
export interface ParseResult {
  events: KeyEvent[];
  mouseEvents: MouseEvent[];   // ← new
  pastes: string[];
  remainder: string;
}
```

`StdinProvider`'s `onData` iterates `mouseEvents` after iterating `events`.

---

## Mouse Mode Lifecycle

### Escape sequences

```ts
const MOUSE_MODE_ENABLE  = '\x1b[?1006h';  // SGR extended mouse reporting on
const MOUSE_MODE_DISABLE = '\x1b[?1006l';
```

Written via the existing `stdoutWrite` stable wrapper in `StdinProvider` (same path as `PASTE_MODE_ENABLE/DISABLE`).

### `StdinProviderState` additions

```ts
interface StdinProviderState {
  // ... existing ...
  mouseSubscribers: Map<(event: MouseEvent) => void, boolean>;
  mouseRefcount: number;
  mouseModeOn: boolean;
}
```

`ensureMouseMode` / `releaseMouseMode` mirror `ensureRawMode` / `releaseRawMode`. Enabling mouse mode also calls `ensureRawMode` (mouse events require raw mode). Disabling mouse mode does not disable raw mode — raw-mode has its own refcount.

### `StdinHookValue` additions (`hooks.ts`)

```ts
subscribeMouseEvent: (
  handler: (event: MouseEvent) => void,
  initialActive?: boolean,
) => () => void;

setMouseActive: (handler: (event: MouseEvent) => void, active: boolean) => void;
```

`subscribeMouseEvent` bumps `mouseRefcount`, calls `ensureMouseMode`. Unsubscribe decrements; at zero calls `releaseMouseMode`.

---

## Handler Registry + Hit-Test (`mouse-registry.ts`)

### WeakMap registry

```ts
export interface MouseHandlers {
  onClick?: (event: MouseEvent) => void;
  onWheel?: (event: MouseEvent) => void;
}

export const mouseRegistry = new WeakMap<ContainerNode, MouseHandlers>();

export function setMouseHandlers(
  node: ContainerNode,
  props: Record<string, unknown>,
): void {
  const onClick = props.onClick as MouseHandlers['onClick'] | undefined;
  const onWheel = props.onWheel as MouseHandlers['onWheel'] | undefined;
  if (onClick || onWheel) mouseRegistry.set(node, { onClick, onWheel });
  else mouseRegistry.delete(node);
}
```

Called by `host-config.ts` in `createInstance` and `commitUpdate`. The WeakMap provides automatic GC when nodes unmount — no `detachDeletedInstance` change needed.

Mouse props are **stripped** from the props written to the render node in `commitUpdate` (alongside the existing `children` exclusion), so `onClick`/`onWheel` never appear on `ContainerNode`.

### `collectHits`

```ts
interface HitNode { node: ContainerNode; depth: number; }

export function collectHits(
  root: ContainerNode,
  col: number,   // 0-based layout coords
  row: number,
  depth = 0,
  acc: HitNode[] = [],
): HitNode[] {
  const lo = (root as { _layout?: ComputedLayout })._layout;
  if (lo) {
    const inside =
      col >= lo.left && col < lo.left + lo.width &&
      row >= lo.top  && row < lo.top  + lo.height;
    if (inside) acc.push({ node: root, depth });
  }
  for (const child of root.children ?? []) {
    if (!isTextNode(child as RenderNode))
      collectHits(child as ContainerNode, col, row, depth + 1, acc);
  }
  return acc;
}
```

Text nodes are skipped (no `children`, no meaningful bounding box for pointer events).

---

## `MouseProvider` + `hitTestAndBubble` (`render.tsx`)

```ts
interface MouseContextValue {
  hitTestAndBubble: (event: MouseEvent) => void;
}

const MouseContext = createContext<MouseContextValue | null>(null);
```

`MouseProvider` receives `container: RootContainer` as a prop and provides a `hitTestAndBubble` function (stable via `useRef`) that:

1. Calls `collectHits(container.root, event.col - 1, event.row - 1)`
2. Sorts hits deepest-first (`b.depth - a.depth`)
3. Attaches `stopPropagation` to the event
4. Iterates hits; for each, looks up the WeakMap:
   - Wheel buttons → `handlers.onWheel?.(ev)`
   - Press + non-wheel → `handlers.onClick?.(ev)`
   - Stops if `stopPropagation` was called

`StdinProvider` reads `MouseContext` and calls `hitTestAndBubble` for each parsed `MouseEvent`, after dispatching to raw `useMouse` subscribers.

---

## `useMouse` hook (`hooks.ts`)

```ts
export function useMouse(
  handler: (event: MouseEvent) => void,
  options: UseMouseOptions = {},
): void
```

`UseMouseOptions` mirrors `UseInputOptions` (`isActive?: boolean`). Implementation mirrors `useInput` exactly — stable dispatch wrapper via `handlerRef` + `dispatchRef`, subscribe effect on `[v]`, `setMouseActive` effect for `isActive` changes.

Raw events include move events (`button: 'none'`), giving callers full positional data for custom hit-testing or drag logic.

---

## `<Box>` API (`components.tsx`)

```ts
export type BoxProps = LayoutProps & BorderProps & {
  children?: ReactNode;
  ref?: Ref<unknown>;
  onClick?: (event: MouseEvent) => void;
  onWheel?: (event: MouseEvent) => void;
};
```

`Box` remains a thin `createElement('pilates-box', props)` call — no hooks added. The JSX intrinsic for `'pilates-box'` gets the same two props. Handler storage is entirely managed by `host-config.ts`.

---

## `ScrollView` wheel wiring (`scroll-view.tsx`)

`onWheel` is added to the inner `<Box>` render:

```tsx
<Box
  ref={boxRef}
  onWheel={(e) => {
    if (!enabled) return;
    e.stopPropagation();  // prevent outer ScrollView from also scrolling
    if (e.button === 'wheel-up')   setOffset(offsetRef.current - 1);
    if (e.button === 'wheel-down') setOffset(offsetRef.current + 1);
  }}
  {...otherProps}
>
```

`stopPropagation()` is called so nested `ScrollView`s consume their own wheel events without leaking to ancestors.

---

## Test Utilities (`test-utils.ts`)

### `MountWithInputHandle` extension

```ts
export interface MountWithInputHandle<T> {
  // ... existing ...
  sendMouseEvent(event: {
    button: MouseButton;
    col: number;    // 1-based terminal coords
    row: number;
    pressed?: boolean;   // default true
    ctrl?: boolean;
    alt?: boolean;
    shift?: boolean;
  }): void;
}
```

`sendMouseEvent` encodes the struct into a valid SGR sequence via a local `encodeSgrButton` helper (~15 lines) and calls `stdin.emit('data', sequence)` inside `withAct`, mirroring how `sendKey` works.

---

## Test Plan

| File | Covers |
|---|---|
| `mouse-parser.test.ts` | SGR → `MouseEvent` unit tests: all buttons, modifiers, press/release, move |
| `mouse-registry.test.ts` | `setMouseHandlers` set/clear; `collectHits` with nested layouts and text nodes |
| `mouse-dispatch.test.ts` | Bubbling order; `stopPropagation`; wheel vs click routing; `useMouse` raw events |
| `scroll-view-mouse.test.ts` | `ScrollView` scrolls on wheel; nested scroll isolation via `stopPropagation` |

All interactive tests use `mountWithInput` + `sendMouseEvent`. Parser and registry tests are pure unit tests with no React.

---

## Constraints + Non-decisions

- **No hover in this version.** `onMouseEnter` / `onMouseLeave` require tracking the previous hit-set and diffing on every move event. Deferred to a follow-up.
- **`onClick` fires on press only**, not release. Matches conventional terminal UI behavior (no "mousedown + mouseup = click" synthesis needed).
- **Mouse mode requires TTY.** If `stdin.isTTY !== true`, mouse mode is not enabled (same gate as raw mode). No silent failures.
- **Release events** reach raw `useMouse` subscribers but do not trigger `onClick` on boxes. Apps that need press-release tracking use `useMouse`.
- **Z-order** is determined by tree depth (deepest ContainerNode = highest z). Pilates has no explicit z-index, so depth in the render tree is the only proxy.
