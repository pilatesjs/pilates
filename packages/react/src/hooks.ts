import { createContext, useContext, useEffect, useRef } from 'react';
import { PilatesError, PilatesErrorCode } from './errors/index.js';
import type { MouseEvent } from './mouse-event.js';

export interface AppHookValue {
  exit: (error?: Error) => void;
}

export interface StdoutHookValue {
  stdout: NodeJS.WriteStream;
  write: (s: string) => boolean;
  columns: number;
  rows: number;
}

export interface StderrHookValue {
  stderr: NodeJS.WriteStream;
  write: (s: string) => boolean;
}

export type KeyName =
  | 'enter'
  | 'escape'
  | 'tab'
  | 'backspace'
  | 'delete'
  | 'space'
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'pageUp'
  | 'pageDown'
  | 'home'
  | 'end'
  | 'f1'
  | 'f2'
  | 'f3'
  | 'f4'
  | 'f5'
  | 'f6'
  | 'f7'
  | 'f8'
  | 'f9'
  | 'f10'
  | 'f11'
  | 'f12';

export interface KeyEvent {
  /** Semantic key name when one applies (arrows, F-keys, named specials). */
  name?: KeyName;
  /** Printable Unicode character. Multi-byte CJK / emoji passes through unchanged. undefined for non-printables. */
  ch?: string;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  /** Raw input bytes that produced this event. */
  sequence: string;
}

export interface UseInputOptions {
  /** When false, the handler does not receive keystrokes. Defaults to true. */
  isActive?: boolean;
}

export interface StdinHookValue {
  stdin: NodeJS.ReadStream;
  /**
   * Subscribe a handler to keystroke events. Returns an unsubscribe
   * function. The handler is called for every keystroke the underlying
   * stdin produces (broadcast — no focus filtering in v0.2).
   *
   * Pass `initialActive: false` to register the handler in an inactive
   * state so the refcount and raw-mode toggle do not fire on mount —
   * useful for components that conditionally enable input.
   */
  subscribe: (handler: (event: KeyEvent) => void, initialActive?: boolean) => () => void;
  /**
   * Mark a previously-subscribed handler as active or inactive without
   * unsubscribing it. Affects the raw-mode refcount: a handler going
   * inactive releases its hold on raw mode; going active reclaims it.
   */
  setActive: (handler: (event: KeyEvent) => void, active: boolean) => void;
  /**
   * Subscribe a handler to bracketed-paste payloads (DEC mode 2004).
   * The handler receives the entire pasted text in one call, with
   * newlines / control bytes preserved verbatim — never as keystroke
   * events. Returns an unsubscribe function. Bumps the same refcount
   * as `subscribe`, so a paste-only app still activates raw mode.
   */
  subscribePaste: (handler: (text: string) => void) => () => void;
  /**
   * Subscribe a handler to raw mouse events (button presses, releases, and
   * wheel ticks). Returns an unsubscribe function. Bumps the mouse-mode
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
  /** True when the underlying stdin supports raw mode (typically `stdin.isTTY === true`). */
  isRawModeSupported: boolean;
}

export const AppContext = createContext<AppHookValue | null>(null);
export const StdoutContext = createContext<StdoutHookValue | null>(null);
export const StderrContext = createContext<StderrHookValue | null>(null);
export const StdinContext = createContext<StdinHookValue | null>(null);

export function useApp(): AppHookValue {
  const v = useContext(AppContext);
  if (!v)
    throw new PilatesError(
      PilatesErrorCode.HookOutsideRender,
      'useApp() must be used inside <render>.',
      { meta: { hookName: 'useApp' } },
    );
  return v;
}

export function useStdout(): StdoutHookValue {
  const v = useContext(StdoutContext);
  if (!v)
    throw new PilatesError(
      PilatesErrorCode.HookOutsideRender,
      'useStdout() must be used inside <render>.',
      { meta: { hookName: 'useStdout' } },
    );
  return v;
}

/**
 * Convenience hook returning just the terminal dimensions. Re-renders on
 * SIGWINCH (`stdout.emit('resize')`). Equivalent to picking
 * `{ columns, rows }` off `useStdout()`; offered for parity with the
 * `useWindowSize` name peer libraries use.
 */
export function useWindowSize(): { columns: number; rows: number } {
  const { columns, rows } = useStdout();
  return { columns, rows };
}

export function useStderr(): StderrHookValue {
  const v = useContext(StderrContext);
  if (!v)
    throw new PilatesError(
      PilatesErrorCode.HookOutsideRender,
      'useStderr() must be used inside <render>.',
      { meta: { hookName: 'useStderr' } },
    );
  return v;
}

/**
 * Subscribe to bracketed-paste payloads. The handler receives the entire
 * pasted text in one call (newlines and control bytes preserved), never as
 * a flood of keystroke events through `useInput`. Activating this hook
 * also engages raw mode, so a paste-only app works without an additional
 * `useInput` call.
 */
export function usePaste(handler: (text: string) => void): void {
  const v = useContext(StdinContext);
  if (!v)
    throw new PilatesError(
      PilatesErrorCode.HookOutsideRender,
      'usePaste() must be used inside <render>.',
      { meta: { hookName: 'usePaste' } },
    );

  // Same handler-ref pattern as useInput: keep a stable dispatch wrapper
  // so the subscribe effect's deps don't churn on every parent render.
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  const dispatchRef = useRef<((text: string) => void) | null>(null);
  if (dispatchRef.current === null) {
    dispatchRef.current = (text: string) => handlerRef.current(text);
  }

  useEffect(() => {
    const dispatch = dispatchRef.current;
    if (dispatch === null) return;
    const unsubscribe = v.subscribePaste(dispatch);
    return () => {
      unsubscribe();
    };
  }, [v]);
}

export function useInput(handler: (event: KeyEvent) => void, options: UseInputOptions = {}): void {
  const v = useContext(StdinContext);
  if (!v)
    throw new PilatesError(
      PilatesErrorCode.HookOutsideRender,
      'useInput() must be used inside <render>.',
      { meta: { hookName: 'useInput' } },
    );
  const isActive = options.isActive ?? true;

  // Capture the latest handler in a ref so we can subscribe a stable
  // dispatch wrapper that delegates to it. Without this, the idiomatic
  // call site `useInput(e => ...)` creates a fresh function on every
  // parent render — and folding handler identity into the subscribe
  // effect's deps would tear down the subscription and rebuild it on
  // every keystroke that triggered a state update. The provider's
  // setActive API is *also* defeated by such churn (it acts on the
  // exact reference that was subscribed). The dispatch wrapper, by
  // contrast, is created once and stays stable for the component's
  // lifetime; setActive can flip it in place.
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  const dispatchRef = useRef<((event: KeyEvent) => void) | null>(null);
  if (dispatchRef.current === null) {
    dispatchRef.current = (event: KeyEvent) => handlerRef.current(event);
  }

  // Capture the initial isActive so the subscribe effect can register the
  // handler in the right state from the start. Subsequent isActive changes
  // are handled by the second effect via setActive.
  const initialActiveRef = useRef(isActive);

  useEffect(() => {
    const dispatch = dispatchRef.current;
    if (dispatch === null) return;
    const unsubscribe = v.subscribe(dispatch, initialActiveRef.current);
    return () => {
      unsubscribe();
    };
  }, [v]);
  // Skip the first invocation: subscribe() already applied the initial value.
  // Otherwise this effect would fire setActive(dispatch, isActive) on mount
  // for an already-correct state, churning the refcount uselessly.
  const setActiveMounted = useRef(false);
  useEffect(() => {
    const dispatch = dispatchRef.current;
    if (dispatch === null) return;
    if (!setActiveMounted.current) {
      setActiveMounted.current = true;
      return;
    }
    v.setActive(dispatch, isActive);
  }, [v, isActive]);
}

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
