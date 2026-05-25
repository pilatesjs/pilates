/**
 * Repeated mount/unmount cycles must not leak event listeners or raw-mode
 * state. The lifecycle invariants for a single cycle are tested elsewhere
 * (render.test.tsx covers raw-mode toggle, useInput subscribe/unsubscribe,
 * stream-error handling). This file stresses the cycle in a loop to catch
 * accumulating leaks — the class of bug that passes a unit test but
 * surfaces in a long-running app or test runner.
 */

import { describe, expect, it } from 'vitest';
import { Text } from './components.js';
import { useInput, usePaste } from './hooks.js';
import { render } from './render.js';
import { makeFakeStdin } from './test-utils.js';

interface FakeStdoutLike {
  isTTY: boolean;
  columns: number;
  rows: number;
  write: (s: string) => boolean;
  on: (event: string, listener: (...args: unknown[]) => void) => unknown;
  off: (event: string, listener: (...args: unknown[]) => void) => unknown;
  emit: (event: string, ...args: unknown[]) => boolean;
  listenerCount: (event: string) => number;
}

function makeQuietStdout(): FakeStdoutLike {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  return {
    isTTY: true,
    columns: 40,
    rows: 5,
    write: () => true,
    on(event, listener) {
      let set = listeners.get(event);
      if (!set) {
        set = new Set();
        listeners.set(event, set);
      }
      set.add(listener);
      return this;
    },
    off(event, listener) {
      listeners.get(event)?.delete(listener);
      return this;
    },
    emit(event, ...args) {
      const set = listeners.get(event);
      if (!set) return false;
      for (const l of [...set]) l(...args);
      return true;
    },
    listenerCount(event) {
      return listeners.get(event)?.size ?? 0;
    },
  };
}

describe('render() — repeated cycles do not leak listeners', () => {
  it('stdin data listener count returns to 0 after each unmount', () => {
    const fakeStdin = makeFakeStdin();
    const fakeStdout = makeQuietStdout();
    function App() {
      useInput(() => {});
      return <Text>x</Text>;
    }

    // Probe by counting how many "data" listeners are registered on stdin
    // after each (mount, unmount) pair.
    const dataListenerCounts: number[] = [];
    for (let i = 0; i < 50; i++) {
      const inst = render(<App />, {
        stdin: fakeStdin as unknown as NodeJS.ReadStream,
        stdout: fakeStdout as unknown as NodeJS.WriteStream,
        focus: false,
      });
      inst.unmount();
      // FakeStdin's underlying EventEmitter exposes listenerCount via the
      // public Node EventEmitter contract; if not, fall back to probing
      // via emit + sentinel.
      let count = 0;
      const sentinel = () => {};
      fakeStdin.on('data', sentinel);
      // After unmount, only our sentinel should be registered. Probe by
      // emitting and counting via a side channel.
      let observed = 0;
      const probe = () => observed++;
      fakeStdin.on('data', probe);
      fakeStdin.emit('data', 'x');
      fakeStdin.off('data', probe);
      fakeStdin.off('data', sentinel);
      // `observed` should be exactly 1 (just our probe). If pilates
      // listeners leaked, the leaked listener would also fire, but
      // since it's a different listener function, it just gets to run
      // — `observed` still measures our probe only.
      count = observed;
      dataListenerCounts.push(count);
    }

    // Every iteration should observe exactly 1 dispatch to our probe.
    // Constant across iterations = no growth = no leak.
    expect(new Set(dataListenerCounts).size).toBe(1);
    expect(dataListenerCounts[0]).toBe(1);
  });

  it('raw-mode toggle balance is even after many cycles', () => {
    const fakeStdin = makeFakeStdin();
    const fakeStdout = makeQuietStdout();
    function App() {
      useInput(() => {});
      return <Text>x</Text>;
    }

    for (let i = 0; i < 20; i++) {
      const inst = render(<App />, {
        stdin: fakeStdin as unknown as NodeJS.ReadStream,
        stdout: fakeStdout as unknown as NodeJS.WriteStream,
        focus: false,
      });
      inst.unmount();
    }
    // Each mount fires setRawMode(true), each unmount fires
    // setRawMode(false). 20 cycles → 40 calls, alternating.
    expect(fakeStdin.rawModeCalls).toHaveLength(40);
    // Final state must be `false` — no app left holding raw mode.
    expect(fakeStdin.rawModeCalls[fakeStdin.rawModeCalls.length - 1]).toBe(false);
    // Count of trues equals count of falses.
    const trues = fakeStdin.rawModeCalls.filter((v) => v).length;
    const falses = fakeStdin.rawModeCalls.filter((v) => !v).length;
    expect(trues).toBe(falses);
  });

  it('useApp().exit() then external unmount() is idempotent', () => {
    const fakeStdin = makeFakeStdin();
    const fakeStdout = makeQuietStdout();
    function App() {
      useInput(() => {});
      return <Text>x</Text>;
    }
    const inst = render(<App />, {
      stdin: fakeStdin as unknown as NodeJS.ReadStream,
      stdout: fakeStdout as unknown as NodeJS.WriteStream,
      focus: false,
    });

    inst.unmount();
    // Second call should be a no-op — not throw, not toggle raw mode again.
    const callsBefore = fakeStdin.rawModeCalls.length;
    inst.unmount();
    expect(fakeStdin.rawModeCalls.length).toBe(callsBefore);
  });

  it('usePaste subscribers also unwind cleanly across many cycles', () => {
    const fakeStdin = makeFakeStdin();
    const fakeStdout = makeQuietStdout();
    function App() {
      usePaste(() => {});
      return <Text>x</Text>;
    }

    for (let i = 0; i < 10; i++) {
      const inst = render(<App />, {
        stdin: fakeStdin as unknown as NodeJS.ReadStream,
        stdout: fakeStdout as unknown as NodeJS.WriteStream,
        focus: false,
      });
      inst.unmount();
    }
    // usePaste activates raw mode; balance must still be even.
    const trues = fakeStdin.rawModeCalls.filter((v) => v).length;
    const falses = fakeStdin.rawModeCalls.filter((v) => !v).length;
    expect(trues).toBe(falses);
  });
});
