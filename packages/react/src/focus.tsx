import {
  Fragment,
  type ReactNode,
  createContext,
  createElement,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { PilatesError, PilatesErrorCode } from './errors/index.js';
import { useInput } from './hooks.js';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface UseFocusOptions {
  /**
   * Stable identifier for programmatic `manager.focus(id)` and React
   * reconciliation. If omitted, an internal id derived from `useId()` is
   * used; you can still focus this hook via the returned `focus()`.
   */
  id?: string;
  /** Take focus on mount if no other focusable currently holds it. Default false. */
  autoFocus?: boolean;
  /**
   * When false, the registration stays in the cycle list (id remains valid)
   * but cannot be Tab-focused and reports `isFocused=false` even if it was
   * previously the focused id. Default true.
   */
  isActive?: boolean;
}

export interface UseFocusValue {
  /** True iff the manager's `focusedId` matches this registration AND focus is enabled AND `isActive`. */
  isFocused: boolean;
  /** Imperatively focus this registration. No-op when focus is disabled. */
  focus: () => void;
  /** Clears focus iff this registration is currently focused. */
  blur: () => void;
  /** The id this hook is registered under (matches `options.id` when given). */
  id: string;
}

export interface UseFocusManagerValue {
  /** Currently focused id, or null if nothing is focused. */
  focusedId: string | null;
  /** Focus a registration by id. Throws in dev if id is not registered. */
  focus: (id: string) => void;
  /** Move focus to the next active registration in cycle order; wraps. */
  focusNext: () => void;
  /** Move focus to the previous active registration in cycle order; wraps. */
  focusPrevious: () => void;
  /** Resume Tab / Shift+Tab handling (the default state). */
  enableFocus: () => void;
  /**
   * Stop Tab / Shift+Tab handling. Pass `{ blur: true }` to also clear
   * the current focus; default keeps `focusedId` pinned so re-enable
   * resumes where it left off.
   */
  disableFocus: (options?: { blur?: boolean }) => void;
  /** True when focus management is enabled (default true). */
  isEnabled: boolean;
}

// ---------------------------------------------------------------------------
// Internal context shape
// ---------------------------------------------------------------------------

interface FocusContextValue {
  focusedId: string | null;
  isEnabled: boolean;
  // Manager API surface
  focus: (id: string) => void;
  focusNext: () => void;
  focusPrevious: () => void;
  enableFocus: () => void;
  disableFocus: (options?: { blur?: boolean }) => void;
  // Internal: registration lifecycle. Underscored to mark as non-public.
  _register: (id: string, isActive: boolean) => void;
  _unregister: (id: string) => void;
  _setActive: (id: string, isActive: boolean) => void;
  _autoFocus: (id: string) => void;
  _setFocused: (id: string | null) => void;
}

const FocusContext = createContext<FocusContextValue | null>(null);

interface FocusRegistration {
  id: string;
  isActive: boolean;
  /** Append-only insertion index. Used to derive cycle order. */
  order: number;
}

interface FocusState {
  registrations: Map<string, FocusRegistration>;
  nextOrder: number;
  focusedId: string | null;
  isEnabled: boolean;
}

// ---------------------------------------------------------------------------
// FocusProvider
// ---------------------------------------------------------------------------

export interface FocusProviderProps {
  /** Initial enabled state. Default true. */
  enabled?: boolean;
  /**
   * If true, Esc clears the currently focused id. Default false — Esc remains
   * free for app-level handlers (e.g., closing a modal, exiting).
   */
  blurOnEscape?: boolean;
  /**
   * If true (default), the provider installs its own `useInput` for
   * Tab / Shift+Tab cycling. Set false to drive cycling manually via
   * `useFocusManager().focusNext()`.
   */
  autoTab?: boolean;
  children?: ReactNode;
}

export function FocusProvider({
  enabled = true,
  blurOnEscape = false,
  autoTab = true,
  children,
}: FocusProviderProps) {
  const stateRef = useRef<FocusState>({
    registrations: new Map(),
    nextOrder: 0,
    focusedId: null,
    isEnabled: enabled,
  });
  // Version bumps trigger context-value rebuild (see useMemo below). The
  // versioned snapshot pattern is equivalent to useSyncExternalStore but
  // avoids reconciler-0.31 timing quirks around getServerSnapshot.
  const [, setVersion] = useState(0);
  const bump = (): void => setVersion((v) => v + 1);

  // ---- mutators (closure-stable references via useMemo on the value) ------

  const setFocused = (id: string | null): void => {
    const state = stateRef.current;
    if (state.focusedId === id) return;
    state.focusedId = id;
    bump();
  };

  const sortedActive = (): FocusRegistration[] => {
    const out: FocusRegistration[] = [];
    for (const reg of stateRef.current.registrations.values()) {
      if (reg.isActive) out.push(reg);
    }
    out.sort((a, b) => a.order - b.order);
    return out;
  };

  const cycle = (delta: 1 | -1): void => {
    const state = stateRef.current;
    if (!state.isEnabled) return;
    const list = sortedActive();
    if (list.length <= 1) return;
    const idx = state.focusedId === null ? -1 : list.findIndex((r) => r.id === state.focusedId);
    if (idx === -1) {
      // Nothing currently focused (or focused id is inactive) — start at the
      // first one for forward, last for backward.
      setFocused(delta === 1 ? list[0]!.id : list[list.length - 1]!.id);
      return;
    }
    const nextIdx = (idx + delta + list.length) % list.length;
    setFocused(list[nextIdx]!.id);
  };

  const register = (id: string, isActive: boolean): void => {
    const state = stateRef.current;
    if (state.registrations.has(id)) {
      // Same id mounted twice — second registration wins, matching React's
      // duplicate-key behavior. Throw in dev so apps surface the bug; warn
      // only in production where DEV is undefined or false.
      if (process.env.NODE_ENV !== 'production') {
        throw new PilatesError(
          PilatesErrorCode.DuplicateFocusId,
          `useFocus({ id: "${id}" }) — duplicate registration. Each focusable must have a unique id.`,
          { meta: { focusId: id } },
        );
      }
      process.stderr.write(
        `Pilates: useFocus({ id: "${id}" }) — duplicate registration; the new mount wins.\n`,
      );
    }
    state.registrations.set(id, { id, isActive, order: state.nextOrder++ });
    bump();
  };

  const unregister = (id: string): void => {
    const state = stateRef.current;
    if (!state.registrations.delete(id)) return;
    if (state.focusedId === id) {
      // Advance to the next active registration in cycle order, or null if none.
      const list = sortedActive();
      state.focusedId = list.length > 0 ? list[0]!.id : null;
    }
    bump();
  };

  const setActive = (id: string, isActive: boolean): void => {
    const state = stateRef.current;
    const reg = state.registrations.get(id);
    if (!reg) return;
    if (reg.isActive === isActive) return;
    reg.isActive = isActive;
    bump();
  };

  const autoFocus = (id: string): void => {
    // First-wins: only takes focus when nothing else is currently focused.
    if (stateRef.current.focusedId === null) setFocused(id);
  };

  const focusById = (id: string): void => {
    const state = stateRef.current;
    if (!state.isEnabled) return;
    if (!state.registrations.has(id)) {
      if (process.env.NODE_ENV !== 'production') {
        throw new PilatesError(
          PilatesErrorCode.FocusIdNotFound,
          `useFocusManager().focus("${id}") — no focusable with id "${id}" is mounted.`,
          { meta: { focusId: id } },
        );
      }
      process.stderr.write(
        `Pilates: useFocusManager().focus("${id}") — no focusable with id "${id}" is mounted; ignoring.\n`,
      );
      return;
    }
    setFocused(id);
  };

  const enableFocus = (): void => {
    const state = stateRef.current;
    if (state.isEnabled) return;
    state.isEnabled = true;
    bump();
  };

  const disableFocus = (options?: { blur?: boolean }): void => {
    const state = stateRef.current;
    let changed = false;
    if (state.isEnabled) {
      state.isEnabled = false;
      changed = true;
    }
    if (options?.blur && state.focusedId !== null) {
      state.focusedId = null;
      changed = true;
    }
    if (changed) bump();
  };

  // ---- context value (stable identity except when state changes) ---------

  const state = stateRef.current;
  // biome-ignore lint/correctness/useExhaustiveDependencies: mutators close over stateRef and are stable for the provider's lifetime; the value should rebuild only when externally-visible state changes
  const value = useMemo<FocusContextValue>(
    () => ({
      focusedId: state.focusedId,
      isEnabled: state.isEnabled,
      focus: focusById,
      focusNext: () => cycle(1),
      focusPrevious: () => cycle(-1),
      enableFocus,
      disableFocus,
      _register: register,
      _unregister: unregister,
      _setActive: setActive,
      _autoFocus: autoFocus,
      _setFocused: setFocused,
    }),
    [state.focusedId, state.isEnabled],
  );

  return createElement(
    FocusContext.Provider,
    { value },
    autoTab ? createElement(FocusInputBridge, { blurOnEscape }, children) : (children as ReactNode),
  );
}

/**
 * Internal child that owns the Tab / Shift+Tab `useInput` subscription.
 * Split out so unmounting/remounting the bridge doesn't re-create the
 * provider's state ref.
 */
function FocusInputBridge({
  blurOnEscape,
  children,
}: {
  blurOnEscape: boolean;
  children?: ReactNode;
}) {
  const ctx = useContext(FocusContext);
  if (!ctx)
    throw new PilatesError(
      PilatesErrorCode.FocusInputBridgeOutsideProvider,
      'FocusInputBridge mounted outside FocusProvider.',
    );
  useInput((event) => {
    if (!ctx.isEnabled) return;
    if (event.name === 'tab' && event.shift) {
      ctx.focusPrevious();
      return;
    }
    if (event.name === 'tab') {
      ctx.focusNext();
      return;
    }
    if (blurOnEscape && event.name === 'escape') {
      ctx._setFocused(null);
    }
  });
  return createElement(Fragment, null, children);
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export function useFocus(options: UseFocusOptions = {}): UseFocusValue {
  const ctx = useContext(FocusContext);
  if (!ctx)
    throw new PilatesError(
      PilatesErrorCode.FocusOutsideProvider,
      'useFocus() must be called inside a tree wrapped by <FocusProvider>.',
      { meta: { hookName: 'useFocus' } },
    );

  const generatedId = useId();
  const id = options.id ?? generatedId;
  const isActive = options.isActive ?? true;
  const autoFocus = options.autoFocus ?? false;

  // Stable focus / blur references survive parent re-renders by routing
  // through refs to the latest context. Identity check tests in the suite
  // depend on this.
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  const idRef = useRef(id);
  idRef.current = id;
  const focusFnRef = useRef<(() => void) | null>(null);
  if (focusFnRef.current === null) {
    focusFnRef.current = () => ctxRef.current.focus(idRef.current);
  }
  const blurFnRef = useRef<(() => void) | null>(null);
  if (blurFnRef.current === null) {
    blurFnRef.current = () => {
      if (ctxRef.current.focusedId === idRef.current) ctxRef.current._setFocused(null);
    };
  }

  // Capture autoFocus initial value so subsequent prop changes don't
  // re-trigger it. Same pattern useInput uses for initialActive.
  const autoFocusOnce = useRef(autoFocus);
  const initialActiveRef = useRef(isActive);

  // Register on mount, unregister on unmount. Re-register if the id changes.
  // Crucially, do NOT depend on `ctx` — its identity changes on every focus
  // change, which would tear down and re-register every focusable on every
  // Tab press, churning the cycle order and clobbering focus state.
  useEffect(() => {
    const c = ctxRef.current;
    c._register(id, initialActiveRef.current);
    if (autoFocusOnce.current) c._autoFocus(id);
    return () => ctxRef.current._unregister(id);
  }, [id]);

  // Toggle active flag in place (mirrors useInput's setActive contract).
  // Skip the first run — register() already applied the initial value.
  const setActiveMounted = useRef(false);
  useEffect(() => {
    if (!setActiveMounted.current) {
      setActiveMounted.current = true;
      return;
    }
    ctxRef.current._setActive(id, isActive);
  }, [id, isActive]);

  const isFocused = ctx.focusedId === id && ctx.isEnabled && isActive;
  return {
    id,
    isFocused,
    focus: focusFnRef.current,
    blur: blurFnRef.current,
  };
}

export function useFocusManager(): UseFocusManagerValue {
  const ctx = useContext(FocusContext);
  if (!ctx)
    throw new PilatesError(
      PilatesErrorCode.FocusOutsideProvider,
      'useFocusManager() must be called inside a tree wrapped by <FocusProvider>.',
      { meta: { hookName: 'useFocusManager' } },
    );
  return {
    focusedId: ctx.focusedId,
    focus: ctx.focus,
    focusNext: ctx.focusNext,
    focusPrevious: ctx.focusPrevious,
    enableFocus: ctx.enableFocus,
    disableFocus: ctx.disableFocus,
    isEnabled: ctx.isEnabled,
  };
}
