import { Component, type ReactNode, createElement } from 'react';
import { Text } from './components.js';
import { isPilatesError } from './errors/index.js';

export interface ErrorBoundaryFallbackProps {
  /** The error caught by the boundary. */
  error: Error;
  /** Clears the error and re-mounts children. */
  reset: () => void;
}

export type ErrorBoundaryFallback = ReactNode | ((error: Error, reset: () => void) => ReactNode);

export interface ErrorBoundaryInfo {
  /** React component stack from the throwing subtree, when available. */
  componentStack?: string;
}

export interface ErrorBoundaryProps {
  children?: ReactNode;
  /**
   * Rendered when a descendant throws during render. Either a static
   * `ReactNode` or a function `(error, reset) => ReactNode`. If omitted, the
   * default fallback renders a red-bordered "Render error" panel with the
   * error message.
   */
  fallback?: ErrorBoundaryFallback;
  /**
   * Called once per caught error. Use for logging / telemetry / writing to
   * stderr. Throws inside `onError` are swallowed so reporting failures do
   * not mask the original error.
   */
  onError?: (error: Error, info: ErrorBoundaryInfo) => void;
  /**
   * When any element of this array changes (referential `!==`), the boundary
   * clears its caught error and re-mounts its children. Use to recover from
   * an error once the upstream cause has been fixed (e.g. user re-typed a
   * valid value, network came back).
   */
  resetKeys?: ReadonlyArray<unknown>;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Catches errors thrown during render in the subtree below it. Renders the
 * `fallback` (or a sensible default) instead of crashing the whole render
 * tree. Sibling components outside the boundary continue rendering.
 *
 * Implemented as a React class component because hooks cannot intercept
 * render-phase errors — only `componentDidCatch` / `getDerivedStateFromError`
 * can. The default fallback uses `<Box>` + `<Text>` so it renders correctly
 * inside the Pilates host config.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorBoundaryInfo): void {
    if (this.props.onError) {
      try {
        this.props.onError(error, info);
      } catch {
        /* swallow — reporting failures must not mask the original error */
      }
    }
  }

  override componentDidUpdate(prevProps: ErrorBoundaryProps): void {
    if (this.state.error === null) return;
    if (!shallowArrayEqual(prevProps.resetKeys, this.props.resetKeys)) {
      this.setState({ error: null });
    }
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (error === null) return this.props.children ?? null;
    return resolveFallback(this.props.fallback, error, this.reset);
  }
}

function shallowArrayEqual(
  a: ReadonlyArray<unknown> | undefined,
  b: ReadonlyArray<unknown> | undefined,
): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function resolveFallback(
  fallback: ErrorBoundaryFallback | undefined,
  error: Error,
  reset: () => void,
): ReactNode {
  if (fallback === undefined) {
    return createElement(DefaultFallback, { error, reset });
  }
  if (typeof fallback === 'function') {
    return fallback(error, reset);
  }
  return fallback;
}

/**
 * Default fallback — a single bold-red line. For a `PilatesError`, formats as
 * `Pilates: <message>` plus a `(<hint>)` tail in development (the hint is
 * empty in production builds). For any other thrown value, falls back to
 * `Render error: <message>`. Kept layout-trivial (no Box wrapper, no border)
 * so it works in the tightest viewport without eating vertical cells; Phase
 * 2's `<ErrorOverview>` renders the full multi-line `formatPilatesError()`
 * output when given a richer area to paint into. Consumers wanting a richer
 * fallback (border, retry, stack, etc.) should pass their own `fallback`.
 */
function DefaultFallback({ error }: ErrorBoundaryFallbackProps): ReactNode {
  if (isPilatesError(error)) {
    const tail = error.hint ? ` (${error.hint})` : '';
    return (
      <Text bold color="red">
        {`Pilates: ${error.message}${tail}`}
      </Text>
    );
  }
  return (
    <Text bold color="red">
      {`Render error: ${error.message}`}
    </Text>
  );
}
