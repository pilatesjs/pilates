import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { Box } from './components.js';
import { useMouse } from './hooks.js';
import type { MouseEvent } from './mouse-event.js';
import { mountWithInput } from './test-utils.js';

describe('useMouse', () => {
  it('receives a mouse event emitted to stdin', () => {
    const received: MouseEvent[] = [];
    function App() {
      useMouse((e) => {
        received.push(e);
      });
      return createElement(Box, { width: 5, height: 5 });
    }
    const { fakeStdin } = mountWithInput(null, () => createElement(App), { width: 40, height: 20 });
    // Left press at col=1, row=1 (SGR: \x1b[<0;1;1M)
    fakeStdin.emit('data', '\x1b[<0;1;1M');
    expect(received).toHaveLength(1);
    expect(received[0]!.button).toBe('left');
    expect(received[0]!.col).toBe(1);
    expect(received[0]!.row).toBe(1);
    expect(received[0]!.pressed).toBe(true);
  });

  it('receives events at positions outside any rendered box', () => {
    const received: MouseEvent[] = [];
    function App() {
      useMouse((e) => {
        received.push(e);
      });
      return createElement(Box, { width: 5, height: 5 });
    }
    const { fakeStdin } = mountWithInput(null, () => createElement(App), { width: 40, height: 20 });
    // Far outside any box
    fakeStdin.emit('data', '\x1b[<0;99;99M');
    expect(received).toHaveLength(1);
  });

  it('receives wheel-up events', () => {
    const received: MouseEvent[] = [];
    function App() {
      useMouse((e) => {
        received.push(e);
      });
      return createElement(Box, { width: 5, height: 5 });
    }
    const { fakeStdin } = mountWithInput(null, () => createElement(App), { width: 40, height: 20 });
    fakeStdin.emit('data', '\x1b[<64;1;1M');
    expect(received[0]!.button).toBe('wheel-up');
  });

  it('stops receiving when isActive becomes false', () => {
    const received: MouseEvent[] = [];
    function App({ active }: { active: boolean }) {
      useMouse(
        (e) => {
          received.push(e);
        },
        { isActive: active },
      );
      return createElement(Box, { width: 5, height: 5 });
    }
    const { fakeStdin, setState } = mountWithInput(
      true as boolean,
      (active) => createElement(App, { active }),
      { width: 40, height: 20 },
    );
    setState(false);
    fakeStdin.emit('data', '\x1b[<0;1;1M');
    expect(received).toHaveLength(0);
  });

  it('resumes receiving when isActive becomes true again', () => {
    const received: MouseEvent[] = [];
    function App({ active }: { active: boolean }) {
      useMouse(
        (e) => {
          received.push(e);
        },
        { isActive: active },
      );
      return createElement(Box, { width: 5, height: 5 });
    }
    const { fakeStdin, setState } = mountWithInput(
      true as boolean,
      (active) => createElement(App, { active }),
      { width: 40, height: 20 },
    );
    setState(false);
    setState(true);
    fakeStdin.emit('data', '\x1b[<0;1;1M');
    expect(received).toHaveLength(1);
  });
});
