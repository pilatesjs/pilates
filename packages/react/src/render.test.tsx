import { describe, expect, it } from 'vitest';
import { mount, renderToString } from './test-utils.js';
import { Box, Newline, Spacer, Text } from './components.js';
import { render } from './render.js';
import { useApp } from './hooks.js';

const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '').replace(/\x1b\[[0-9;]*[Hf]/g, '');

describe('renderToString', () => {
  it('returns empty string when given an empty React element', () => {
    const out = renderToString(<></>, { width: 4, height: 1 });
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
});
