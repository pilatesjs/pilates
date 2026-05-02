import { createContext, useContext, useEffect, useRef } from 'react';

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
   */
  subscribe: (handler: (event: KeyEvent) => void) => () => void;
  /**
   * Mark a previously-subscribed handler as active or inactive without
   * unsubscribing it. Affects the raw-mode refcount: a handler going
   * inactive releases its hold on raw mode; going active reclaims it.
   */
  setActive: (handler: (event: KeyEvent) => void, active: boolean) => void;
  /** True when the underlying stdin supports raw mode (typically `stdin.isTTY === true`). */
  isRawModeSupported: boolean;
}

export const AppContext = createContext<AppHookValue | null>(null);
export const StdoutContext = createContext<StdoutHookValue | null>(null);
export const StderrContext = createContext<StderrHookValue | null>(null);
export const StdinContext = createContext<StdinHookValue | null>(null);

export function useApp(): AppHookValue {
  const v = useContext(AppContext);
  if (!v) throw new Error('Pilates: useApp() must be used inside <render>.');
  return v;
}

export function useStdout(): StdoutHookValue {
  const v = useContext(StdoutContext);
  if (!v) throw new Error('Pilates: useStdout() must be used inside <render>.');
  return v;
}

export function useStderr(): StderrHookValue {
  const v = useContext(StderrContext);
  if (!v) throw new Error('Pilates: useStderr() must be used inside <render>.');
  return v;
}

export function useInput(handler: (event: KeyEvent) => void, options: UseInputOptions = {}): void {
  const v = useContext(StdinContext);
  if (!v) throw new Error('Pilates: useInput() must be used inside <render>.');
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

  useEffect(() => {
    const dispatch = dispatchRef.current;
    if (dispatch === null) return;
    const unsubscribe = v.subscribe(dispatch);
    return () => {
      unsubscribe();
    };
  }, [v]);
  useEffect(() => {
    const dispatch = dispatchRef.current;
    if (dispatch === null) return;
    v.setActive(dispatch, isActive);
  }, [v, isActive]);
}
