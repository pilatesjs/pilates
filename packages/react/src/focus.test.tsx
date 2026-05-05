import { act } from 'react';
import { describe, expect, it } from 'vitest';
import { useFocus, useFocusManager } from './focus.js';
import { useInput } from './hooks.js';
import { mountWithInput } from './test-utils.js';

const opts = { width: 4, height: 1 };

// Returns null — used as a render-time marker so JSX has *something* to mount
// without invoking host-element type-checks.
function Marker(): null {
  return null;
}

// Bypass mountWithInput's per-press act() wrapping for raw byte sequences not
// covered by pressKey (notably Shift+Tab `\x1b[Z`). The wrapper still flushes
// via act() so consumers see the resulting state before the next assertion.
function emitInAct(
  handle: { fakeStdin: { emit: (event: string, ...args: unknown[]) => boolean } },
  bytes: string,
) {
  const g = globalThis as Record<string, unknown>;
  const prev = g.IS_REACT_ACT_ENVIRONMENT;
  g.IS_REACT_ACT_ENVIRONMENT = true;
  try {
    act(() => {
      handle.fakeStdin.emit('data', bytes);
    });
  } finally {
    g.IS_REACT_ACT_ENVIRONMENT = prev;
  }
}

// ---------------------------------------------------------------------------
// registration & basics
// ---------------------------------------------------------------------------

describe('useFocus — registration & basics', () => {
  it('returns isFocused=false when nothing has been focused yet', () => {
    let captured: { isFocused: boolean } | null = null;
    function App() {
      const f = useFocus({ id: 'a' });
      captured = { isFocused: f.isFocused };
      return null;
    }
    const handle = mountWithInput(0, () => <App />, opts);
    expect(captured).toEqual({ isFocused: false });
    handle.unmount();
  });

  it('useFocus throws when no FocusProvider is in scope', () => {
    let captured: unknown = null;
    function App() {
      try {
        useFocus();
      } catch (err) {
        captured = err;
      }
      return null;
    }
    const handle = mountWithInput(0, () => <App />, { ...opts, disableFocus: true });
    expect(captured).toBeInstanceOf(Error);
    expect((captured as Error).message).toMatch(/must be used inside <render>/);
    handle.unmount();
  });

  it('useFocusManager throws when no FocusProvider is in scope', () => {
    let captured: unknown = null;
    function App() {
      try {
        useFocusManager();
      } catch (err) {
        captured = err;
      }
      return null;
    }
    const handle = mountWithInput(0, () => <App />, { ...opts, disableFocus: true });
    expect(captured).toBeInstanceOf(Error);
    expect((captured as Error).message).toMatch(/must be used inside <render>/);
    handle.unmount();
  });

  it('generates a stable id when none is given (survives re-renders)', () => {
    const ids: string[] = [];
    function App() {
      const f = useFocus();
      ids.push(f.id);
      return null;
    }
    const handle = mountWithInput<number>(0, () => <App />, opts);
    handle.setState(1); // forces re-render
    expect(ids.length).toBeGreaterThanOrEqual(2);
    expect(ids[0]).toBeTruthy();
    expect(new Set(ids).size).toBe(1); // same id every render
    handle.unmount();
  });
});

// ---------------------------------------------------------------------------
// autoFocus
// ---------------------------------------------------------------------------

describe('useFocus — autoFocus', () => {
  it('first useFocus({ autoFocus: true }) gets focus on mount', () => {
    let isFocused = false;
    function App() {
      const f = useFocus({ id: 'a', autoFocus: true });
      isFocused = f.isFocused;
      return null;
    }
    const handle = mountWithInput(0, () => <App />, opts);
    expect(isFocused).toBe(true);
    handle.unmount();
  });

  it('second autoFocus mount in same commit does NOT steal from first', () => {
    let aFocused = false;
    let bFocused = false;
    function A() {
      const f = useFocus({ id: 'a', autoFocus: true });
      aFocused = f.isFocused;
      return null;
    }
    function B() {
      const f = useFocus({ id: 'b', autoFocus: true });
      bFocused = f.isFocused;
      return null;
    }
    const handle = mountWithInput(
      0,
      () => (
        <>
          <A />
          <B />
        </>
      ),
      opts,
    );
    expect(aFocused).toBe(true);
    expect(bFocused).toBe(false);
    handle.unmount();
  });

  it('autoFocus mount when focusedId already set does NOT steal', () => {
    let bFocused = false;
    function App({ showB }: { showB: boolean }) {
      useFocus({ id: 'a', autoFocus: true });
      const fb = useFocus({ id: 'b', autoFocus: true });
      bFocused = fb.isFocused;
      return showB ? <Marker /> : null;
    }
    // Even with showB toggling, both useFocus calls happen each render — so
    // 'b' registers later but should still not steal because 'a' holds focus.
    const handle = mountWithInput<boolean>(false, (s) => <App showB={s} />, opts);
    handle.setState(true);
    expect(bFocused).toBe(false);
    handle.unmount();
  });
});

// ---------------------------------------------------------------------------
// Tab cycling
// ---------------------------------------------------------------------------

describe('useFocus — Tab cycling', () => {
  it('Tab cycles through three registered hooks in mount order', () => {
    const focused: Record<string, boolean> = { a: false, b: false, c: false };
    function App() {
      focused.a = useFocus({ id: 'a', autoFocus: true }).isFocused;
      focused.b = useFocus({ id: 'b' }).isFocused;
      focused.c = useFocus({ id: 'c' }).isFocused;
      return null;
    }
    const handle = mountWithInput(0, () => <App />, opts);
    expect(focused).toEqual({ a: true, b: false, c: false });
    handle.pressKey('tab');
    expect(focused).toEqual({ a: false, b: true, c: false });
    handle.pressKey('tab');
    expect(focused).toEqual({ a: false, b: false, c: true });
    handle.unmount();
  });

  it('Shift+Tab (\\x1b[Z) cycles backwards', () => {
    const focused: Record<string, boolean> = { a: false, b: false, c: false };
    function App() {
      focused.a = useFocus({ id: 'a', autoFocus: true }).isFocused;
      focused.b = useFocus({ id: 'b' }).isFocused;
      focused.c = useFocus({ id: 'c' }).isFocused;
      return null;
    }
    const handle = mountWithInput(0, () => <App />, opts);
    emitInAct(handle, '\x1b[Z'); // Shift+Tab
    expect(focused).toEqual({ a: false, b: false, c: true });
    emitInAct(handle, '\x1b[Z');
    expect(focused).toEqual({ a: false, b: true, c: false });
    handle.unmount();
  });

  it('Tab wraps from last to first; Shift+Tab wraps first → last', () => {
    const focused: Record<string, boolean> = { a: false, b: false };
    function App() {
      focused.a = useFocus({ id: 'a', autoFocus: true }).isFocused;
      focused.b = useFocus({ id: 'b' }).isFocused;
      return null;
    }
    const handle = mountWithInput(0, () => <App />, opts);
    handle.pressKey('tab'); // a → b
    handle.pressKey('tab'); // b → a (wrap)
    expect(focused).toEqual({ a: true, b: false });
    emitInAct(handle, '\x1b[Z'); // Shift+Tab: a → b (wrap reverse)
    expect(focused).toEqual({ a: false, b: true });
    handle.unmount();
  });

  it('Tab is a no-op when only one active registration exists', () => {
    let renderCount = 0;
    function App() {
      renderCount++;
      useFocus({ id: 'only', autoFocus: true });
      return null;
    }
    const handle = mountWithInput(0, () => <App />, opts);
    const before = renderCount;
    handle.pressKey('tab');
    handle.pressKey('tab');
    // Tab on a single registration should not re-render — no focus change.
    expect(renderCount).toBe(before);
    handle.unmount();
  });

  it('Tab is a no-op when no registration exists (no error thrown)', () => {
    const handle = mountWithInput(0, () => <Marker />, opts);
    expect(() => handle.pressKey('tab')).not.toThrow();
    handle.unmount();
  });

  it('Tab skips registrations with isActive=false', () => {
    const focused: Record<string, boolean> = { a: false, b: false, c: false };
    function App() {
      focused.a = useFocus({ id: 'a', autoFocus: true }).isFocused;
      focused.b = useFocus({ id: 'b', isActive: false }).isFocused;
      focused.c = useFocus({ id: 'c' }).isFocused;
      return null;
    }
    const handle = mountWithInput(0, () => <App />, opts);
    handle.pressKey('tab');
    expect(focused).toEqual({ a: false, b: false, c: true }); // skipped 'b'
    handle.unmount();
  });
});

// ---------------------------------------------------------------------------
// Programmatic focus
// ---------------------------------------------------------------------------

describe('useFocus — programmatic focus', () => {
  it('manager.focus(id) jumps focus to the named registration', () => {
    const focused: Record<string, boolean> = { a: false, b: false };
    const mgrRef: { current: ReturnType<typeof useFocusManager> | null } = { current: null };
    function App() {
      focused.a = useFocus({ id: 'a', autoFocus: true }).isFocused;
      focused.b = useFocus({ id: 'b' }).isFocused;
      mgrRef.current = useFocusManager();
      return null;
    }
    const handle = mountWithInput(0, () => <App />, opts);
    handle.setState(1); // re-render so we can use mgr
    mgrRef.current?.focus('b');
    handle.setState(2); // flush
    expect(focused.b).toBe(true);
    expect(focused.a).toBe(false);
    handle.unmount();
  });

  it('manager.focus(id) for unknown id throws in dev', () => {
    const mgrRef: { current: ReturnType<typeof useFocusManager> | null } = { current: null };
    function App() {
      mgrRef.current = useFocusManager();
      return null;
    }
    const handle = mountWithInput(0, () => <App />, opts);
    expect(() => mgrRef.current?.focus('nope')).toThrow(/no focusable with id "nope"/);
    handle.unmount();
  });

  it('useFocus().focus() focuses the calling registration', () => {
    let aFocused = false;
    const holder: { bFocus: (() => void) | null } = { bFocus: null };
    function App() {
      aFocused = useFocus({ id: 'a', autoFocus: true }).isFocused;
      const b = useFocus({ id: 'b' });
      holder.bFocus = b.focus;
      return null;
    }
    const handle = mountWithInput(0, () => <App />, opts);
    holder.bFocus?.();
    handle.setState(1); // flush
    expect(aFocused).toBe(false);
    handle.unmount();
  });

  it('useFocus().blur() clears focus only when this id was focused', () => {
    let aFocused = false;
    let bFocused = false;
    const holder: { aBlur: (() => void) | null; bBlur: (() => void) | null } = {
      aBlur: null,
      bBlur: null,
    };
    function App() {
      const a = useFocus({ id: 'a', autoFocus: true });
      const b = useFocus({ id: 'b' });
      aFocused = a.isFocused;
      bFocused = b.isFocused;
      holder.aBlur = a.blur;
      holder.bBlur = b.blur;
      return null;
    }
    const handle = mountWithInput(0, () => <App />, opts);
    holder.bBlur?.(); // not focused → no-op
    handle.setState(1);
    expect(aFocused).toBe(true);
    holder.aBlur?.(); // focused → clears
    handle.setState(2);
    expect(aFocused).toBe(false);
    expect(bFocused).toBe(false);
    handle.unmount();
  });
});

// ---------------------------------------------------------------------------
// Conditional unmount
// ---------------------------------------------------------------------------

describe('useFocus — conditional unmount', () => {
  it('unmounting the focused element advances to next registration', () => {
    const mgrRef: { current: ReturnType<typeof useFocusManager> | null } = { current: null };
    function A() {
      useFocus({ id: 'a', autoFocus: true });
      return null;
    }
    function B() {
      useFocus({ id: 'b' });
      return null;
    }
    function App({ showA }: { showA: boolean }) {
      mgrRef.current = useFocusManager();
      return (
        <>
          {showA && <A />}
          <B />
        </>
      );
    }
    const handle = mountWithInput<boolean>(true, (s) => <App showA={s} />, opts);
    expect(mgrRef.current?.focusedId).toBe('a');
    handle.setState(false); // unmount A
    expect(mgrRef.current?.focusedId).toBe('b');
    handle.unmount();
  });

  it('unmounting the only registration sets focusedId to null', () => {
    const mgrRef: { current: ReturnType<typeof useFocusManager> | null } = { current: null };
    function A() {
      useFocus({ id: 'a', autoFocus: true });
      return null;
    }
    function App({ showA }: { showA: boolean }) {
      mgrRef.current = useFocusManager();
      return showA ? <A /> : null;
    }
    const handle = mountWithInput<boolean>(true, (s) => <App showA={s} />, opts);
    expect(mgrRef.current?.focusedId).toBe('a');
    handle.setState(false);
    expect(mgrRef.current?.focusedId).toBe(null);
    handle.unmount();
  });
});

// ---------------------------------------------------------------------------
// Enable / disable
// ---------------------------------------------------------------------------

describe('useFocusManager — enable/disable', () => {
  it('disableFocus() makes Tab a no-op but keeps focusedId', () => {
    const focused: Record<string, boolean> = { a: false, b: false };
    const mgrRef: { current: ReturnType<typeof useFocusManager> | null } = { current: null };
    function App() {
      focused.a = useFocus({ id: 'a', autoFocus: true }).isFocused;
      focused.b = useFocus({ id: 'b' }).isFocused;
      mgrRef.current = useFocusManager();
      return null;
    }
    const handle = mountWithInput(0, () => <App />, opts);
    mgrRef.current?.disableFocus();
    handle.setState(1);
    handle.pressKey('tab');
    expect(focused).toEqual({ a: false, b: false }); // a was focused, but isFocused=false because !isEnabled
    expect(mgrRef.current?.focusedId).toBe('a'); // still pinned
    handle.unmount();
  });

  it('disableFocus({ blur: true }) clears focusedId', () => {
    const mgrRef: { current: ReturnType<typeof useFocusManager> | null } = { current: null };
    function App() {
      useFocus({ id: 'a', autoFocus: true });
      mgrRef.current = useFocusManager();
      return null;
    }
    const handle = mountWithInput(0, () => <App />, opts);
    mgrRef.current?.disableFocus({ blur: true });
    handle.setState(1);
    expect(mgrRef.current?.focusedId).toBe(null);
    handle.unmount();
  });

  it('enableFocus() resumes Tab handling on the still-pinned id', () => {
    const focused: Record<string, boolean> = { a: false, b: false };
    const mgrRef: { current: ReturnType<typeof useFocusManager> | null } = { current: null };
    function App() {
      focused.a = useFocus({ id: 'a', autoFocus: true }).isFocused;
      focused.b = useFocus({ id: 'b' }).isFocused;
      mgrRef.current = useFocusManager();
      return null;
    }
    const handle = mountWithInput(0, () => <App />, opts);
    mgrRef.current?.disableFocus();
    handle.setState(1);
    expect(focused.a).toBe(false);
    mgrRef.current?.enableFocus();
    handle.setState(2);
    expect(focused.a).toBe(true); // restored on still-pinned id
    handle.unmount();
  });
});

// ---------------------------------------------------------------------------
// Escape (opt-in)
// ---------------------------------------------------------------------------

describe('useFocus — blurOnEscape', () => {
  it('blurOnEscape=false (default): Esc does not clear focusedId', async () => {
    const mgrRef: { current: ReturnType<typeof useFocusManager> | null } = { current: null };
    function App() {
      useFocus({ id: 'a', autoFocus: true });
      mgrRef.current = useFocusManager();
      return null;
    }
    const handle = mountWithInput(0, () => <App />, opts);
    handle.pressKey('escape');
    await new Promise((r) => setTimeout(r, 80)); // bare-ESC disambiguation flush
    expect(mgrRef.current?.focusedId).toBe('a');
    handle.unmount();
  });
});

// ---------------------------------------------------------------------------
// Integration with useInput
// ---------------------------------------------------------------------------

describe('useFocus — integration with useInput', () => {
  it('two listeners gated on isFocused: Tab routes typing to the focused one', () => {
    const heard = { a: '', b: '' };
    function Listener({ id }: { id: 'a' | 'b' }) {
      const f = useFocus({ id, autoFocus: id === 'a' });
      useInput(
        (e) => {
          if (e.ch) heard[id] += e.ch;
        },
        { isActive: f.isFocused },
      );
      return null;
    }
    const handle = mountWithInput(
      0,
      () => (
        <>
          <Listener id="a" />
          <Listener id="b" />
        </>
      ),
      opts,
    );
    handle.pressChar('1');
    expect(heard).toEqual({ a: '1', b: '' });
    handle.pressKey('tab');
    handle.pressChar('2');
    expect(heard).toEqual({ a: '1', b: '2' });
    handle.unmount();
  });
});

// ---------------------------------------------------------------------------
// Re-render stability
// ---------------------------------------------------------------------------

describe('useFocus — re-render stability', () => {
  it('parent re-render does not change useFocus().focus identity', () => {
    const captured: Array<() => void> = [];
    function App() {
      const f = useFocus({ id: 'a' });
      captured.push(f.focus);
      return null;
    }
    const handle = mountWithInput<number>(0, () => <App />, opts);
    handle.setState(1);
    handle.setState(2);
    expect(captured.length).toBeGreaterThanOrEqual(3);
    expect(captured[0]).toBe(captured[1]);
    expect(captured[1]).toBe(captured[2]);
    handle.unmount();
  });
});
