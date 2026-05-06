import { Component, type ReactNode, act, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Text } from './components.js';
import { ErrorBoundary } from './error-boundary.js';
import { PilatesError, PilatesErrorCode, isPilatesError } from './errors/index.js';
import { mountWithInput, renderToString } from './test-utils.js';

// Wrap a side-effecting call in React 19's act() so any setState it triggers
// flushes before the next assertion. Used for callbacks captured from a
// component (like ErrorBoundary's `reset`) that fire outside the test util's
// own act-wrapped helpers.
function inAct(fn: () => void): void {
  const g = globalThis as Record<string, unknown>;
  const prev = g.IS_REACT_ACT_ENVIRONMENT;
  g.IS_REACT_ACT_ENVIRONMENT = true;
  try {
    act(fn);
  } finally {
    g.IS_REACT_ACT_ENVIRONMENT = prev;
  }
}

const opts = { width: 40, height: 5 };

function stripSGR(s: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ESC (0x1b) is exactly what we want to strip
  const noSgr = s.replace(/\x1b\[[0-9;]*m/g, '');
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ESC (0x1b) is exactly what we want to strip
  return noSgr.replace(/\x1b\[[0-9;]*[Hf]/g, '').replace(/\n$/, '');
}

// Component that throws on first render, then renders normally after
// `setState(false)`. Lets tests force-throw and reset.
function Crashy({ shouldCrash, message }: { shouldCrash: boolean; message: string }) {
  if (shouldCrash) throw new Error(message);
  // Single string template (not "literal: {var}") because Pilates Text
  // children that mix literals and expressions concatenate without joiner
  // spaces — we want the assertions below to match plain "recovered=ok"
  // regardless of that quirk.
  return <Text>{`recovered=${message}`}</Text>;
}

// Class component that unconditionally throws — reused by several tests.
class AlwaysThrow extends Component<{ message: string }> {
  render(): ReactNode {
    throw new Error(this.props.message);
  }
}

describe('ErrorBoundary — basic catching', () => {
  it('renders children when no error thrown', () => {
    const out = stripSGR(
      renderToString(
        <ErrorBoundary>
          <Text>hello</Text>
        </ErrorBoundary>,
        opts,
      ),
    );
    expect(out).toContain('hello');
  });

  it('renders fallback when a child throws on initial render', () => {
    // Suppress React's noisy re-throw logging so the test runner stays clean.
    const origConsoleError = console.error;
    console.error = () => {};
    try {
      const out = stripSGR(
        renderToString(
          <ErrorBoundary fallback={(err) => <Text>caught: {err.message}</Text>}>
            <AlwaysThrow message="boom!" />
          </ErrorBoundary>,
          opts,
        ),
      );
      expect(out).toContain('caught: boom!');
    } finally {
      console.error = origConsoleError;
    }
  });

  it('uses the default fallback when no fallback prop is provided', () => {
    const origConsoleError = console.error;
    console.error = () => {};
    try {
      const out = stripSGR(
        renderToString(
          <ErrorBoundary>
            <AlwaysThrow message="default-fallback-test" />
          </ErrorBoundary>,
          opts,
        ),
      );
      // Default fallback shows the error message and an explanatory header.
      expect(out).toContain('Render error');
      expect(out).toContain('default-fallback-test');
    } finally {
      console.error = origConsoleError;
    }
  });

  it('calls onError(error, info) when a child throws', () => {
    const origConsoleError = console.error;
    console.error = () => {};
    const onError = vi.fn<(err: Error, info: { componentStack?: string }) => void>();
    try {
      renderToString(
        <ErrorBoundary onError={onError} fallback={() => <Text>caught</Text>}>
          <AlwaysThrow message="hook-test" />
        </ErrorBoundary>,
        opts,
      );
      expect(onError).toHaveBeenCalledTimes(1);
      const args = onError.mock.calls[0]!;
      expect(args[0]).toBeInstanceOf(Error);
      expect(args[0].message).toBe('hook-test');
      // info.componentStack is provided by react-reconciler in dev builds.
      expect(typeof args[1]).toBe('object');
    } finally {
      console.error = origConsoleError;
    }
  });
});

describe('ErrorBoundary — isolation', () => {
  it('isolates the error: siblings outside the boundary continue rendering', () => {
    const origConsoleError = console.error;
    console.error = () => {};
    try {
      const out = stripSGR(
        renderToString(
          <>
            <Text>before</Text>
            <ErrorBoundary fallback={() => <Text>caught</Text>}>
              <AlwaysThrow message="x" />
            </ErrorBoundary>
            <Text>after</Text>
          </>,
          opts,
        ),
      );
      expect(out).toContain('before');
      expect(out).toContain('caught');
      expect(out).toContain('after');
    } finally {
      console.error = origConsoleError;
    }
  });
});

describe('ErrorBoundary — resetKeys', () => {
  it('a change in resetKeys clears the error and re-renders children', () => {
    const origConsoleError = console.error;
    console.error = () => {};
    try {
      // Outer state controls (a) the resetKeys array passed to the boundary
      // and (b) the shouldCrash flag of Crashy. Toggling state from {1,true}
      // → {2,false} should both reset the boundary and stop the throw.
      function Driver({ phase }: { phase: 1 | 2 }) {
        return (
          <ErrorBoundary resetKeys={[phase]} fallback={() => <Text>caught</Text>}>
            <Crashy shouldCrash={phase === 1} message="ok" />
          </ErrorBoundary>
        );
      }
      const handle = mountWithInput<1 | 2>(1, (s) => <Driver phase={s} />, opts);
      expect(stripSGR(handle.lastWrite())).toContain('caught');
      handle.setState(2);
      expect(stripSGR(handle.lastWrite())).toContain('recovered=ok');
      handle.unmount();
    } finally {
      console.error = origConsoleError;
    }
  });

  it('no resetKeys change keeps the boundary in error state', () => {
    const origConsoleError = console.error;
    console.error = () => {};
    try {
      function Driver({ phase }: { phase: 1 | 2 }) {
        // Note: NO resetKeys prop — the boundary stays in its caught state
        // even when shouldCrash flips.
        return (
          <ErrorBoundary fallback={() => <Text>caught</Text>}>
            <Crashy shouldCrash={phase === 1} message="ok" />
          </ErrorBoundary>
        );
      }
      const handle = mountWithInput<1 | 2>(1, (s) => <Driver phase={s} />, opts);
      expect(stripSGR(handle.lastWrite())).toContain('caught');
      handle.setState(2);
      // Without resetKeys, the boundary doesn't know the underlying problem
      // is fixed; it keeps showing the fallback.
      expect(stripSGR(handle.lastWrite())).toContain('caught');
      handle.unmount();
    } finally {
      console.error = origConsoleError;
    }
  });
});

describe('ErrorBoundary — fallback shapes', () => {
  it('accepts a ReactNode fallback (no error info)', () => {
    const origConsoleError = console.error;
    console.error = () => {};
    try {
      const out = stripSGR(
        renderToString(
          <ErrorBoundary fallback={<Text>static fallback</Text>}>
            <AlwaysThrow message="x" />
          </ErrorBoundary>,
          opts,
        ),
      );
      expect(out).toContain('static fallback');
    } finally {
      console.error = origConsoleError;
    }
  });

  it('passes (error, reset) to a function fallback', () => {
    const origConsoleError = console.error;
    console.error = () => {};
    try {
      let captured: { message: string; resetIsFn: boolean } | null = null;
      const handle = mountWithInput<number>(
        0,
        () => (
          <ErrorBoundary
            fallback={(err, reset) => {
              captured = { message: err.message, resetIsFn: typeof reset === 'function' };
              return <Text>{`err: ${err.message}`}</Text>;
            }}
          >
            <AlwaysThrow message="check-args" />
          </ErrorBoundary>
        ),
        opts,
      );
      expect(captured).toEqual({ message: 'check-args', resetIsFn: true });
      handle.unmount();
    } finally {
      console.error = origConsoleError;
    }
  });

  it('reset() callback clears the error and re-mounts children', () => {
    const origConsoleError = console.error;
    console.error = () => {};
    try {
      const holder: { reset: (() => void) | null } = { reset: null };
      function Inner({ shouldCrash }: { shouldCrash: boolean }) {
        if (shouldCrash) throw new Error('reset-test');
        return <Text>ok</Text>;
      }
      function Driver({ shouldCrash }: { shouldCrash: boolean }) {
        return (
          <ErrorBoundary
            fallback={(_err, reset) => {
              holder.reset = reset;
              return <Text>caught</Text>;
            }}
          >
            <Inner shouldCrash={shouldCrash} />
          </ErrorBoundary>
        );
      }
      const handle = mountWithInput<boolean>(true, (s) => <Driver shouldCrash={s} />, opts);
      expect(stripSGR(handle.lastWrite())).toContain('caught');
      // Outer state flips first → no throw on next render. Then reset() to
      // clear the boundary's caught flag. Wrap reset() in act() so the
      // resulting state update flushes before the next lastWrite() read.
      handle.setState(false);
      inAct(() => holder.reset?.());
      // After reset, children re-render — and since shouldCrash is now false,
      // they render normally.
      expect(stripSGR(handle.lastWrite())).toContain('ok');
      handle.unmount();
    } finally {
      console.error = origConsoleError;
    }
  });
});

describe('ErrorBoundary — PilatesError componentStack capture', () => {
  it('attaches errorInfo.componentStack onto a thrown PilatesError', () => {
    const origConsoleError = console.error;
    console.error = () => {};
    try {
      let captured: unknown = null;
      function Bomb(): never {
        throw new PilatesError(PilatesErrorCode.HookOutsideRender, 'kaboom');
      }
      function App() {
        return (
          <ErrorBoundary
            onError={(err) => {
              captured = err;
            }}
          >
            <Bomb />
          </ErrorBoundary>
        );
      }
      const handle = mountWithInput(0, () => <App />, { width: 20, height: 1 });
      expect(isPilatesError(captured)).toBe(true);
      if (isPilatesError(captured)) {
        expect(captured.componentStack).toMatch(/Bomb/);
        expect(captured.componentStack).toMatch(/App/);
      }
      handle.unmount();
    } finally {
      console.error = origConsoleError;
    }
  });
});

// This test references useState to ensure tree-shake doesn't drop it.
void useState;
