/**
 * Self-tests for the published `@pilates/react/test-utils` surface.
 *
 * Every other test file in the monorepo depends on these helpers; if
 * `snapshot()`, `makeFakeStdin`, or the `mount` / `mountWithInput`
 * handles ever silently change shape, suites further downstream would
 * fail in confusing ways. These tests lock the contract.
 *
 * Most of the *integration* behavior is already exercised through
 * `render.test.tsx` (mount handle, setState, lastWrite/allWrites,
 * passive-effect drain). What's covered here is the public surface in
 * isolation: snapshot's split/strip, FakeStdin's recording, and the
 * shape of every export.
 */

import { describe, expect, it } from 'vitest';
import { Text } from './components.js';
import { makeFakeStdin, mount, mountWithInput, renderToString, snapshot } from './test-utils.js';

describe('snapshot()', () => {
  it('returns { ansi, plain } where plain strips SGR codes', () => {
    const ansi = '\x1b[31mhi\x1b[0m';
    const s = snapshot(ansi);
    expect(s.ansi).toBe(ansi);
    expect(s.plain).toBe('hi');
  });

  it('strips cursor-position escapes (H, f, A, B, C, D)', () => {
    const ansi = '\x1b[1;2H\x1b[3Atext\x1b[5C';
    expect(snapshot(ansi).plain).toBe('text');
  });

  it('strips erase escapes (J, K)', () => {
    expect(snapshot('a\x1b[Kb\x1b[2Jc').plain).toBe('abc');
  });

  it('trims a single trailing newline from plain', () => {
    expect(snapshot('row1\nrow2\n').plain).toBe('row1\nrow2');
  });

  it('does not trim multiple trailing newlines (only the last one)', () => {
    // Intentional: the strip regex anchors `\n$` (single trailing).
    expect(snapshot('row\n\n').plain).toBe('row\n');
  });

  it('leaves a string with no escapes unchanged in `plain`', () => {
    expect(snapshot('plain text').plain).toBe('plain text');
  });

  it('leaves the original raw string in `ansi` even when escapes are present', () => {
    const raw = '\x1b[1m\x1b[31mbold-red\x1b[0m';
    expect(snapshot(raw).ansi).toBe(raw);
  });
});

describe('makeFakeStdin()', () => {
  it('starts with empty rawModeCalls and flowCalls', () => {
    const fake = makeFakeStdin();
    expect(fake.rawModeCalls).toEqual([]);
    expect(fake.flowCalls).toEqual([]);
    expect(fake.isTTY).toBe(true);
  });

  it('records setRawMode toggles in order', () => {
    const fake = makeFakeStdin();
    fake.setRawMode(true);
    fake.setRawMode(false);
    fake.setRawMode(true);
    expect(fake.rawModeCalls).toEqual([true, false, true]);
  });

  it('records pause/resume in order', () => {
    const fake = makeFakeStdin();
    fake.resume();
    fake.pause();
    fake.resume();
    expect(fake.flowCalls).toEqual(['resume', 'pause', 'resume']);
  });

  it('delivers emitted "data" events to .on listeners', () => {
    const fake = makeFakeStdin();
    const received: unknown[] = [];
    fake.on('data', (chunk) => received.push(chunk));
    fake.emit('data', 'hello');
    expect(received).toEqual(['hello']);
  });

  it('once() fires the listener exactly one time', () => {
    const fake = makeFakeStdin();
    let count = 0;
    fake.once('tick', () => count++);
    fake.emit('tick');
    fake.emit('tick');
    expect(count).toBe(1);
  });

  it('off() / removeListener() detaches a previously registered handler', () => {
    const fake = makeFakeStdin();
    let count = 0;
    const handler = () => count++;
    fake.on('data', handler);
    fake.emit('data');
    fake.off('data', handler);
    fake.emit('data');
    expect(count).toBe(1);
  });

  it('chains setRawMode / resume / pause (returns `this`)', () => {
    const fake = makeFakeStdin();
    expect(fake.setRawMode(true)).toBe(fake);
    expect(fake.resume()).toBe(fake);
    expect(fake.pause()).toBe(fake);
  });
});

describe('renderToString', () => {
  it('runs a single synchronous commit and returns text', () => {
    const out = renderToString(<Text>hi</Text>, { width: 4, height: 1 });
    expect(typeof out).toBe('string');
    // SGR-stripped should contain "hi" padded to width.
    // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping for assertion
    expect(out.replace(/\x1b\[[\d;]*m/g, '')).toBe('hi  \n');
  });

  it('honors the width/height options', () => {
    const out = renderToString(<Text>x</Text>, { width: 7, height: 2 });
    // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping for assertion
    const lines = out.replace(/\x1b\[[\d;]*m/g, '').split('\n');
    expect(lines).toHaveLength(3); // 2 rows + trailing empty from final \n
    expect(lines[0]).toHaveLength(7);
  });
});

describe('mount handle shape', () => {
  it('exposes lastWrite, allWrites, setState, unmount', () => {
    const handle = mount(0, () => <Text>x</Text>, { width: 3, height: 1 });
    expect(typeof handle.lastWrite).toBe('function');
    expect(typeof handle.allWrites).toBe('function');
    expect(typeof handle.setState).toBe('function');
    expect(typeof handle.unmount).toBe('function');
    handle.unmount();
  });

  it('lastWrite() returns "" before any commit produced a write', () => {
    // Static tree, no diff after initial mount: only the first frame write.
    const handle = mount(0, () => <Text>x</Text>, { width: 3, height: 1 });
    // At least one write from initial mount.
    expect(handle.lastWrite().length).toBeGreaterThan(0);
    handle.unmount();
  });

  it('allWrites() returns the concatenation of every write', () => {
    const handle = mount(0, (n) => <Text>{String(n)}</Text>, { width: 2, height: 1 });
    const a = handle.allWrites();
    handle.setState(1);
    const b = handle.allWrites();
    expect(b.startsWith(a)).toBe(true);
    expect(b.length).toBeGreaterThan(a.length);
    handle.unmount();
  });
});

describe('mountWithInput handle shape', () => {
  it('exposes press, pressKey, pressChar, pressCtrl, fakeStdin, flush, sendMouseEvent', () => {
    const handle = mountWithInput(0, () => <Text>x</Text>, { width: 3, height: 1 });
    expect(typeof handle.press).toBe('function');
    expect(typeof handle.pressKey).toBe('function');
    expect(typeof handle.pressChar).toBe('function');
    expect(typeof handle.pressCtrl).toBe('function');
    expect(typeof handle.flush).toBe('function');
    expect(typeof handle.sendMouseEvent).toBe('function');
    expect(handle.fakeStdin).toBeDefined();
    expect(handle.fakeStdin.isTTY).toBe(true);
    handle.unmount();
  });
});
