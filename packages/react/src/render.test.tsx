import { useEffect, useState } from 'react';
import { describe, expect, it } from 'vitest';
import { Box, Newline, Spacer, Text } from './components.js';
import { useApp, useInput, useStdout, useWindowSize } from './hooks.js';
import { render } from './render.js';
import { makeFakeStdin, mount, mountWithInput, renderToString } from './test-utils.js';

// biome-ignore lint/suspicious/noControlCharactersInRegex: ESC (0x1b) is exactly what we want to strip
const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '').replace(/\x1b\[[0-9;]*[Hf]/g, '');

describe('renderToString', () => {
  it('returns empty string when given an empty React element', () => {
    // biome-ignore lint/complexity/noUselessFragments: testing the empty-fragment input case is the point
    const out = renderToString(<></>, { width: 4, height: 1 });
    // biome-ignore lint/suspicious/noControlCharactersInRegex: ESC (0x1b) is exactly what we want to strip
    expect(out.replace(/\x1b\[[0-9;]*m/g, '')).toBe('    \n');
  });
});

describe('static rendering', () => {
  it('renders a single Text into the frame', () => {
    const out = stripAnsi(renderToString(<Text>hello</Text>, { width: 5, height: 1 }));
    expect(out).toBe('hello\n');
  });

  it('renders a Box with a Text child', () => {
    const out = stripAnsi(
      renderToString(
        <Box width={7} height={1}>
          <Text>hi</Text>
        </Box>,
        { width: 7, height: 1 },
      ),
    );
    expect(out).toBe('hi     \n');
  });

  it('matches the imperative API output cell-for-cell', async () => {
    const fromReact = stripAnsi(
      renderToString(
        <Box width={10} height={2} flexDirection="row">
          <Text>a</Text>
          <Text>b</Text>
        </Box>,
        { width: 10, height: 2 },
      ),
    );
    const { render: imperative } = await import('@pilates/render');
    const fromImperative = imperative(
      {
        width: 10,
        height: 2,
        flexDirection: 'row',
        children: [{ text: 'a' }, { text: 'b' }],
      },
      { ansi: false },
    );
    expect(fromReact.trim()).toBe(fromImperative.trim());
  });

  it('Spacer expands to fill row gap', () => {
    const out = stripAnsi(
      renderToString(
        <Box width={10} height={1} flexDirection="row">
          <Text>a</Text>
          <Spacer />
          <Text>b</Text>
        </Box>,
        { width: 10, height: 1 },
      ),
    );
    expect(out).toBe('a        b\n');
  });

  it('Newline injects \\n into Text', () => {
    const out = stripAnsi(
      renderToString(
        <Text>
          line1
          {'\n'}
          line2
        </Text>,
        { width: 6, height: 2 },
      ),
    );
    expect(out).toBe('line1 \nline2 \n');
  });
});

// `Newline` is imported above so the function is referenced and the
// component round-trips through JSX type-checking; the test uses an
// inline `{'\n'}` literal because that's the more common idiom.
void Newline;

describe('re-render diff', () => {
  it('re-render after setState emits only changed cells', () => {
    const handle = mount(
      0,
      (n) => (
        <Box width={5} height={1}>
          <Text>n={String(n)}</Text>
        </Box>
      ),
      { width: 5, height: 1 },
    );
    const initial = handle.allWrites();
    // applyDiff interleaves a cursor code before every cell, so the
    // characters 'n', '=', '0' never appear contiguously in the raw
    // bytes — strip cursor codes first.
    expect(stripAnsi(initial)).toContain('n=0');

    handle.setState(7);

    const last = handle.lastWrite();
    expect(last).toContain('7');
    // The substring 'n=' would only appear in the raw ANSI if both
    // characters were emitted without a cursor code between them, which
    // implies a full repaint.
    expect(last).not.toContain('n=');
  });

  it('re-render with no changes emits zero ANSI writes', () => {
    const handle = mount(
      'static',
      () => (
        <Box width={6} height={1}>
          <Text>same</Text>
        </Box>
      ),
      { width: 6, height: 1 },
    );
    const writeCountBefore = handle.allWrites().length;
    handle.setState('static-but-key-unused-by-render');
    const writeCountAfter = handle.allWrites().length;
    expect(writeCountAfter).toBe(writeCountBefore);
  });
});

describe('mount() drains passive effects', () => {
  it('fires useEffect on initial mount before returning', () => {
    const fires: string[] = [];
    function Hooked() {
      useEffect(() => {
        fires.push('mounted');
      }, []);
      return <Text>x</Text>;
    }
    const handle = mount(0, () => <Hooked />, { width: 4, height: 1 });
    expect(fires).toEqual(['mounted']);
    handle.unmount();
  });

  it('fires deps-keyed useEffect when setState changes the dep', () => {
    const fires: number[] = [];
    function Counter({ count }: { count: number }) {
      useEffect(() => {
        fires.push(count);
      }, [count]);
      return <Text>{String(count)}</Text>;
    }
    const handle = mount(0, (count) => <Counter count={count} />, { width: 4, height: 1 });
    expect(fires).toEqual([0]);
    handle.setState(5);
    expect(fires).toEqual([0, 5]);
    handle.unmount();
  });

  it('commits cascading state updates scheduled from inside an effect', () => {
    function Cascade() {
      const [v, setV] = useState('initial');
      useEffect(() => {
        setV('after-effect');
      }, []);
      return <Text>{v}</Text>;
    }
    const handle = mount(0, () => <Cascade />, { width: 16, height: 1 });
    expect(stripAnsi(handle.lastWrite())).toContain('after-effect');
    handle.unmount();
  });
});

describe('conditional rendering', () => {
  it('mounts and unmounts branches cleanly', () => {
    const handle = mount(
      true,
      (visible) => (
        <Box width={6} height={1}>
          {visible && <Text>shown</Text>}
        </Box>
      ),
      { width: 6, height: 1 },
    );
    expect(stripAnsi(handle.allWrites())).toContain('shown');

    handle.setState(false);
    expect(handle.lastWrite()).not.toContain('shown');
  });

  it('switching between two children replaces correctly', () => {
    const handle = mount(
      'a',
      (which) => (
        <Box width={3} height={1}>
          {which === 'a' ? <Text>aaa</Text> : <Text>bbb</Text>}
        </Box>
      ),
      { width: 3, height: 1 },
    );
    expect(stripAnsi(handle.allWrites())).toContain('aaa');
    handle.setState('b');
    expect(stripAnsi(handle.lastWrite())).toContain('bbb');
  });
});

describe('composition', () => {
  it('Fragment children render as siblings', () => {
    const out = stripAnsi(
      renderToString(
        <Box width={6} height={1} flexDirection="row">
          <>
            <Text>a</Text>
            <Text>b</Text>
            <Text>c</Text>
          </>
        </Box>,
        { width: 6, height: 1 },
      ),
    );
    expect(out).toBe('abc   \n');
  });

  it('arrays with keys render in order', () => {
    const items = ['x', 'y', 'z'];
    const out = stripAnsi(
      renderToString(
        <Box width={6} height={1} flexDirection="row">
          {items.map((s) => (
            <Text key={s}>{s}</Text>
          ))}
        </Box>,
        { width: 6, height: 1 },
      ),
    );
    expect(out).toBe('xyz   \n');
  });

  it('reordering keyed children re-renders correctly', () => {
    const handle = mount<string[]>(
      ['a', 'b', 'c'],
      (items) => (
        <Box width={6} height={1} flexDirection="row">
          {items.map((s) => (
            <Text key={s}>{s}</Text>
          ))}
        </Box>
      ),
      { width: 6, height: 1 },
    );
    expect(stripAnsi(handle.allWrites())).toContain('abc');
    handle.setState(['c', 'b', 'a']);
    // Reordering ['a','b','c'] → ['c','b','a'] moves 'a' and 'c' but
    // leaves 'b' in place, so the diff should only re-emit cells 0 and 2.
    // The middle 'b' must NOT appear in the latest write (it would imply
    // a full repaint).
    const last = stripAnsi(handle.lastWrite());
    expect(last).toContain('c');
    expect(last).toContain('a');
    expect(last).not.toContain('b');
  });

  it('user-defined components compose primitives', () => {
    function Greeting({ name }: { name: string }) {
      return <Text>hi {name}</Text>;
    }
    const out = stripAnsi(
      renderToString(
        <Box width={9} height={1}>
          <Greeting name="ada" />
        </Box>,
        { width: 9, height: 1 },
      ),
    );
    expect(out).toBe('hi ada   \n');
  });

  it('nested <Text> propagates state updates to the outer node', () => {
    // Regression: TextNode in @pilates/render has no children slot — only
    // the outermost <Text>'s node.text gets painted. Before the fix,
    // commitTextUpdate re-flattened only the immediate parent, so updates
    // to a string fragment inside a nested <Text> never reached the outer
    // node — the diff between frames was empty and lastWrite returned no
    // new bytes at all.
    const handle = mount(
      'aaa',
      (s) => (
        <Box width={9} height={1}>
          <Text>
            outer-<Text>{s}</Text>
          </Text>
        </Box>
      ),
      { width: 9, height: 1 },
    );
    expect(stripAnsi(handle.allWrites())).toContain('outer-aaa');
    const beforeLength = handle.allWrites().length;
    handle.setState('xyz');
    // The fragment changed from 'aaa' to 'xyz' — three cells changed.
    // Before the fix, outer.node.text was frozen at mount, the diff
    // produced no cells, and allWrites() length wouldn't grow at all.
    expect(handle.allWrites().length).toBeGreaterThan(beforeLength);
    const last = stripAnsi(handle.lastWrite());
    expect(last).toContain('x');
    expect(last).toContain('y');
    expect(last).toContain('z');
    // 'outer-' didn't change so its cells aren't in the latest diff.
    expect(last).not.toContain('outer-');
  });

  it('appending a <Text> child inside <Text> repaints the outer node', () => {
    const handle = mount(
      false,
      (showInner) => (
        <Box width={12} height={1}>
          <Text>outer-{showInner && <Text>added</Text>}</Text>
        </Box>
      ),
      { width: 12, height: 1 },
    );
    expect(stripAnsi(handle.allWrites())).toContain('outer-');
    expect(stripAnsi(handle.allWrites())).not.toContain('added');
    const beforeLength = handle.allWrites().length;
    handle.setState(true);
    // Mounting the inner <Text> grows the outer's flattened text from
    // 'outer-' to 'outer-added' — five new non-space cells. Before the
    // fix, the outer's node.text didn't update and the diff was empty.
    expect(handle.allWrites().length).toBeGreaterThan(beforeLength);
    const last = stripAnsi(handle.lastWrite());
    expect(last).toContain('a');
    expect(last).toContain('d');
    expect(last).toContain('e');
  });
});

function makeFakeStdout(columns: number, rows: number): NodeJS.WriteStream {
  const buf: string[] = [];
  const stream = {
    columns,
    rows,
    isTTY: true as const,
    write: (s: string | Uint8Array) => {
      buf.push(typeof s === 'string' ? s : Buffer.from(s).toString('utf8'));
      return true;
    },
    on: () => stream,
    off: () => stream,
    once: () => stream,
    removeListener: () => stream,
  } as unknown as NodeJS.WriteStream;
  (stream as unknown as { __buf: string[] }).__buf = buf;
  return stream;
}

describe('hooks', () => {
  it('useApp().exit() resolves waitUntilExit', async () => {
    function App() {
      const { exit } = useApp();
      Promise.resolve().then(() => exit());
      return <Text>hi</Text>;
    }
    const fakeStdout = makeFakeStdout(20, 5);
    const fakeStderr = makeFakeStdout(20, 5);
    const instance = render(<App />, { stdout: fakeStdout, stderr: fakeStderr });
    await instance.waitUntilExit();
    expect(true).toBe(true);
  });

  it('useApp().exit(error) rejects waitUntilExit', async () => {
    function App() {
      const { exit } = useApp();
      Promise.resolve().then(() => exit(new Error('boom')));
      return <Text>hi</Text>;
    }
    const fakeStdout = makeFakeStdout(20, 5);
    const fakeStderr = makeFakeStdout(20, 5);
    const instance = render(<App />, { stdout: fakeStdout, stderr: fakeStderr });
    await expect(instance.waitUntilExit()).rejects.toThrow('boom');
  });

  it('useStdout reflects resize via stdout.emit("resize")', async () => {
    function App() {
      const { columns, rows } = useStdout();
      return <Text>{`${columns}x${rows}`}</Text>;
    }
    const stdout = makeFakeStdout(20, 5);
    // Make stdout an event-emitter so 'resize' can be simulated.
    const { EventEmitter } = await import('node:events');
    const ee = new EventEmitter();
    (stdout as unknown as { on: typeof ee.on; off: typeof ee.off; emit: typeof ee.emit }).on =
      ee.on.bind(ee);
    (stdout as unknown as { off: typeof ee.off }).off = ee.off.bind(ee);
    (stdout as unknown as { emit: typeof ee.emit }).emit = ee.emit.bind(ee);
    const writes = (stdout as unknown as { __buf: string[] }).__buf;

    const instance = render(<App />, { stdout, stderr: makeFakeStdout(20, 5) });
    expect(stripAnsi(writes.join(''))).toContain('20x5');

    // simulate resize
    (stdout as unknown as { columns: number }).columns = 30;
    (stdout as unknown as { rows: number }).rows = 8;
    ee.emit('resize');
    // give effect time to run
    await new Promise((r) => setTimeout(r, 0));
    expect(stripAnsi(writes.join(''))).toContain('30x8');

    instance.unmount();
  });

  it('useWindowSize returns columns/rows and reflects resize', async () => {
    function App() {
      const { columns, rows } = useWindowSize();
      return <Text>{`${columns}x${rows}`}</Text>;
    }
    const stdout = makeFakeStdout(40, 10);
    const { EventEmitter } = await import('node:events');
    const ee = new EventEmitter();
    (stdout as unknown as { on: typeof ee.on; off: typeof ee.off; emit: typeof ee.emit }).on =
      ee.on.bind(ee);
    (stdout as unknown as { off: typeof ee.off }).off = ee.off.bind(ee);
    (stdout as unknown as { emit: typeof ee.emit }).emit = ee.emit.bind(ee);
    const writes = (stdout as unknown as { __buf: string[] }).__buf;

    const instance = render(<App />, { stdout, stderr: makeFakeStdout(20, 5) });
    expect(stripAnsi(writes.join(''))).toContain('40x10');

    (stdout as unknown as { columns: number }).columns = 80;
    (stdout as unknown as { rows: number }).rows = 24;
    ee.emit('resize');
    await new Promise((r) => setTimeout(r, 0));
    expect(stripAnsi(writes.join(''))).toContain('80x24');

    instance.unmount();
  });

  it('rejects waitUntilExit when stdout emits an error', async () => {
    const { EventEmitter } = await import('node:events');
    const ee = new EventEmitter();
    const stdout = makeFakeStdout(20, 5);
    (stdout as unknown as { on: typeof ee.on; off: typeof ee.off; emit: typeof ee.emit }).on =
      ee.on.bind(ee);
    (stdout as unknown as { off: typeof ee.off }).off = ee.off.bind(ee);
    (stdout as unknown as { emit: typeof ee.emit }).emit = ee.emit.bind(ee);

    const instance = render(<Text>x</Text>, { stdout, stderr: makeFakeStdout(20, 5) });
    ee.emit('error', new Error('EPIPE'));
    await expect(instance.waitUntilExit()).rejects.toThrow('EPIPE');
  });
});

describe('examples smoke', () => {
  it('react-counter App renders without throwing', async () => {
    const { App } = await import('../../../examples/react-counter/index.tsx');
    // Import render from the same package resolution the example uses so
    // AppContext is the same singleton instance.
    const { render: pkgRender } = await import('@pilates/react');
    const stdout = makeFakeStdout(22, 7);
    const stderr = makeFakeStdout(22, 7);
    const buf = (stdout as unknown as { __buf: string[] }).__buf;
    const instance = pkgRender(<App />, { stdout, stderr });
    // Immediately unmount to clean up setInterval / setTimeout
    instance.unmount();
    await instance.waitUntilExit();
    const out = stripAnsi(buf.join(''));
    expect(out).toContain('counter');
    expect(out).toContain('n = 0');
  });

  it('react-dashboard App renders without throwing', async () => {
    const { App } = await import('../../../examples/react-dashboard/index.tsx');
    const { render: pkgRender } = await import('@pilates/react');
    const stdout = makeFakeStdout(60, 12);
    const stderr = makeFakeStdout(60, 12);
    const buf = (stdout as unknown as { __buf: string[] }).__buf;
    const instance = pkgRender(<App />, { stdout, stderr });
    instance.unmount();
    await instance.waitUntilExit();
    const out = stripAnsi(buf.join(''));
    expect(out).toContain('Pilates Dashboard');
  });

  it('react-modal App renders without throwing', async () => {
    const { App } = await import('../../../examples/react-modal/index.tsx');
    const { render: pkgRender } = await import('@pilates/react');
    const stdout = makeFakeStdout(60, 16);
    const stderr = makeFakeStdout(60, 16);
    const buf = (stdout as unknown as { __buf: string[] }).__buf;
    const instance = pkgRender(<App />, { stdout, stderr });
    instance.unmount();
    await instance.waitUntilExit();
    const out = stripAnsi(buf.join(''));
    expect(out).toContain('Confirm action');
  });

  // react-wizard exercises @pilates/widgets and is interactive (useInput-driven).
  // The immediate-unmount smoke pattern used for the static examples above
  // doesn't paint a frame before teardown, so the wizard intentionally has
  // no smoke test — it's exercised manually via `pnpm --filter
  // @pilates-examples/react-wizard dev`.
});

describe('validation', () => {
  it('throws when <Text> contains a <Box>', () => {
    expect(() =>
      renderToString(
        <Text>
          <Box width={1} height={1} />
        </Text>,
        { width: 5, height: 1 },
      ),
    ).toThrow(/<Text> children must be string, number, <Text>, or <Newline>/);
  });

  it('throws when bare strings appear at the root', () => {
    // biome-ignore lint/complexity/noUselessFragments: a bare-string root is exactly what we're validating against
    expect(() => renderToString(<>{'bare'}</>, { width: 5, height: 1 })).toThrow(
      /bare strings are not allowed/,
    );
  });

  it('component-thrown render error rejects waitUntilExit and writes to stderr', async () => {
    function Boom(): never {
      throw new Error('kaboom');
    }
    const stdout = makeFakeStdout(20, 5);
    const stderr = makeFakeStdout(20, 5);
    const stderrBuf = (stderr as unknown as { __buf: string[] }).__buf;
    const instance = render(<Boom />, { stdout, stderr });
    await expect(instance.waitUntilExit()).rejects.toThrow('kaboom');
    expect(stderrBuf.join('')).toContain('Pilates render error');
  });
});

describe('useInput', () => {
  it('receives a single keypress', () => {
    const seen: string[] = [];
    const handle = mountWithInput(
      0,
      () => {
        useInput((event) => {
          if (event.ch) seen.push(event.ch);
        });
        return <Text>x</Text>;
      },
      { width: 5, height: 1 },
    );
    handle.pressChar('a');
    expect(seen).toEqual(['a']);
    handle.unmount();
  });

  it('decodes named keys via the parser path', async () => {
    const seen: string[] = [];
    const handle = mountWithInput(
      0,
      () => {
        useInput((event) => {
          if (event.name) seen.push(event.name);
        });
        return <Text>x</Text>;
      },
      { width: 5, height: 1 },
    );
    handle.pressKey('up');
    handle.pressKey('escape');
    // A bare ESC byte is held by the parser pending disambiguation
    // (could prefix CSI/SS3/Alt). Wait past the ~50 ms flush window.
    await new Promise((r) => setTimeout(r, 80));
    expect(seen).toEqual(['up', 'escape']);
    handle.unmount();
  });

  it('reassembles a CSI arrow key whose ESC arrives in a separate chunk', async () => {
    const seen: string[] = [];
    const handle = mountWithInput(
      0,
      () => {
        useInput((event) => {
          if (event.name) seen.push(event.name);
        });
        return <Text>x</Text>;
      },
      { width: 5, height: 1 },
    );
    // Simulate the OS splitting `\x1b[A` across two reads. Before the
    // disambiguation timer fires the `[A` arrives, so we should see a
    // single `up` event (not `escape` followed by literal '[' and 'A').
    handle.fakeStdin.emit('data', '\x1b');
    handle.fakeStdin.emit('data', '[A');
    await new Promise((r) => setTimeout(r, 80));
    expect(seen).toEqual(['up']);
    handle.unmount();
  });

  it('isActive: false suppresses delivery', () => {
    const seen: string[] = [];
    const handle = mountWithInput<{ active: boolean }>(
      { active: false },
      (state) => {
        useInput(
          (event) => {
            if (event.ch) seen.push(event.ch);
          },
          { isActive: state.active },
        );
        return <Text>x</Text>;
      },
      { width: 5, height: 1 },
    );
    handle.pressChar('a');
    expect(seen).toEqual([]);
    handle.setState({ active: true });
    handle.pressChar('b');
    expect(seen).toEqual(['b']);
    handle.unmount();
  });

  it('initial isActive: false does not flash raw mode on/off during mount', () => {
    const handle = mountWithInput(
      0,
      () => {
        useInput(() => {}, { isActive: false });
        return <Text>x</Text>;
      },
      { width: 5, height: 1 },
    );
    // Without initial-active plumbing, subscribe always bumped refcount and
    // turned raw mode on, then setActive(false) immediately turned it off →
    // [true, false]. Correct behavior is to never enable raw mode at all.
    expect(handle.fakeStdin.rawModeCalls).toEqual([]);
    handle.unmount();
    expect(handle.fakeStdin.rawModeCalls).toEqual([]);
  });

  it('multiple subscribers all fire in mount order', () => {
    const seen: string[] = [];
    function Listener({ id }: { id: string }) {
      useInput((event) => {
        if (event.ch) seen.push(`${id}:${event.ch}`);
      });
      return null;
    }
    const handle = mountWithInput(
      0,
      () => (
        <Box width={1} height={1}>
          <Listener id="a" />
          <Listener id="b" />
        </Box>
      ),
      { width: 1, height: 1 },
    );
    handle.pressChar('q');
    expect(seen).toEqual(['a:q', 'b:q']);
    handle.unmount();
  });

  it('unmount removes subscriber', () => {
    const seen: string[] = [];
    function Listener() {
      useInput((event) => {
        if (event.ch) seen.push(event.ch);
      });
      return null;
    }
    const handle = mountWithInput<boolean>(
      true,
      (visible) => (
        <Box width={1} height={1}>
          {visible && <Listener />}
        </Box>
      ),
      { width: 1, height: 1 },
    );
    handle.pressChar('a');
    expect(seen).toEqual(['a']);
    handle.setState(false);
    handle.pressChar('b');
    expect(seen).toEqual(['a']);
    handle.unmount();
  });
});

describe('useInput lifecycle', () => {
  it('enters raw mode on first mount', () => {
    function App() {
      useInput(() => {});
      return <Text>x</Text>;
    }
    const handle = mountWithInput(0, () => <App />, { width: 1, height: 1 });
    expect(handle.fakeStdin.rawModeCalls).toEqual([true]);
    handle.unmount();
  });

  it('exits raw mode on last unmount', () => {
    function App() {
      useInput(() => {});
      return <Text>x</Text>;
    }
    const handle = mountWithInput(0, () => <App />, { width: 1, height: 1 });
    handle.unmount();
    expect(handle.fakeStdin.rawModeCalls).toEqual([true, false]);
  });

  it('does not enter raw mode when no useInput is mounted', () => {
    const handle = mountWithInput(0, () => <Text>x</Text>, { width: 1, height: 1 });
    expect(handle.fakeStdin.rawModeCalls).toEqual([]);
    handle.unmount();
  });

  it('toggling isActive does not churn raw mode (uses setActive, not unsub/resub)', () => {
    // Regression: useInput used to fold `isActive` into the subscribe
    // effect's dep array, so toggling it tore down the subscription and
    // rebuilt it — which forced the raw-mode refcount through 0 and back,
    // re-toggling raw mode and dropping any keystrokes that landed in the
    // teardown→re-subscribe window. The fix splits the subscribe and
    // active-toggle paths: subscribe is identity-stable, setActive flips
    // the flag in place and only releases raw mode when the refcount
    // really hits 0.
    function App({ active }: { active: boolean }) {
      useInput(() => {}, { isActive: active });
      return <Text>x</Text>;
    }
    const handle = mountWithInput<{ active: boolean }>(
      { active: true },
      (s) => <App active={s.active} />,
      { width: 1, height: 1 },
    );
    expect(handle.fakeStdin.rawModeCalls).toEqual([true]);
    handle.setState({ active: false });
    // setActive(false) drops refcount → raw mode releases.
    expect(handle.fakeStdin.rawModeCalls).toEqual([true, false]);
    handle.setState({ active: true });
    // setActive(true) reclaims raw mode — exactly one toggle, not three
    // (which is what unsub→resub would have produced).
    expect(handle.fakeStdin.rawModeCalls).toEqual([true, false, true]);
    handle.unmount();
    expect(handle.fakeStdin.rawModeCalls).toEqual([true, false, true, false]);
  });

  it('render() binds stdin synchronously before returning', () => {
    // Regression: passive effects (useEffect) used to fire on the next
    // event-loop tick, after render() had already returned. With nothing
    // pinning the loop alive, Node could exit before stdin was ever
    // attached. render() now drains passive effects in-band, so
    // setRawMode + the data listener are wired up by the time the call
    // returns — verifiable by inspecting the fake stdin synchronously.
    const fakeStdin = makeFakeStdin();
    const fakeStdout = makeFakeStdout(20, 5);
    const fakeStderr = makeFakeStdout(20, 5);
    function App() {
      useInput(() => {});
      return <Text>x</Text>;
    }
    const instance = render(<App />, {
      stdout: fakeStdout,
      stderr: fakeStderr,
      stdin: fakeStdin as unknown as NodeJS.ReadStream,
    });
    expect(fakeStdin.rawModeCalls).toEqual([true]);
    instance.unmount();
  });

  it('survives setRawMode throwing', () => {
    function App() {
      useInput(() => {});
      return <Text>x</Text>;
    }
    const handle = mountWithInput(0, () => <App />, { width: 1, height: 1 });
    handle.fakeStdin.setRawMode = () => {
      throw new Error('boom');
    };
    expect(() => handle.unmount()).not.toThrow();
  });
});

describe('useInput composition', () => {
  it('mounts/unmounts cleanly under conditional rendering', () => {
    const seen: string[] = [];
    function Listener() {
      useInput((event) => {
        if (event.ch) seen.push(event.ch);
      });
      return null;
    }
    const handle = mountWithInput<{ which: 'a' | 'b' | 'none' }>(
      { which: 'a' },
      (state) => (
        <Box width={1} height={1}>
          {state.which === 'a' && <Listener />}
          {state.which === 'b' && <Listener />}
        </Box>
      ),
      { width: 1, height: 1 },
    );
    handle.pressChar('1');
    expect(seen).toEqual(['1']);

    handle.setState({ which: 'b' });
    handle.pressChar('2');
    expect(seen).toEqual(['1', '2']);

    handle.setState({ which: 'none' });
    handle.pressChar('3');
    expect(seen).toEqual(['1', '2']);
    handle.unmount();
  });
});

describe('useInput end-to-end', () => {
  it('keypress drives setState and re-renders', () => {
    function App() {
      const [n, setN] = useState(0);
      useInput((event) => {
        if (event.name === 'up') setN((x) => x + 1);
      });
      return <Text>n={n}</Text>;
    }
    const handle = mountWithInput(0, () => <App />, { width: 5, height: 1 });
    expect(stripAnsi(handle.allWrites())).toContain('n=0');
    handle.pressKey('up');
    handle.pressKey('up');
    expect(stripAnsi(handle.lastWrite())).toContain('2');
    handle.unmount();
  });
});
