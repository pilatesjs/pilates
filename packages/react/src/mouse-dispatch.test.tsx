import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Box } from './components.js';
import type { MouseEvent } from './mouse-event.js';
import { mountWithInput } from './test-utils.js';

describe('onClick on <Box>', () => {
  it('fires when the box is clicked', () => {
    const handler = vi.fn();
    const { sendMouseEvent } = mountWithInput(
      null,
      () => createElement(Box, { onClick: handler, width: 20, height: 10 }),
      { width: 40, height: 20 },
    );
    sendMouseEvent({ button: 'left', col: 1, row: 1 });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]![0].button).toBe('left');
    expect(handler.mock.calls[0]![0].col).toBe(1);
  });

  it('does not fire when click is outside the box', () => {
    const handler = vi.fn();
    const { sendMouseEvent } = mountWithInput(
      null,
      () => createElement(Box, { onClick: handler, width: 5, height: 5 }),
      { width: 40, height: 20 },
    );
    // Box occupies cols 1–5, rows 1–5; click at col=10 is outside
    sendMouseEvent({ button: 'left', col: 10, row: 1 });
    expect(handler).not.toHaveBeenCalled();
  });

  it('does not fire on release events (pressed=false)', () => {
    const handler = vi.fn();
    const { sendMouseEvent } = mountWithInput(
      null,
      () => createElement(Box, { onClick: handler, width: 20, height: 10 }),
      { width: 40, height: 20 },
    );
    sendMouseEvent({ button: 'left', col: 1, row: 1, pressed: false });
    expect(handler).not.toHaveBeenCalled();
  });

  it('passes a stopPropagation method on the event', () => {
    const handler = vi.fn((e: MouseEvent) => {
      expect(typeof e.stopPropagation).toBe('function');
    });
    const { sendMouseEvent } = mountWithInput(
      null,
      () => createElement(Box, { onClick: handler, width: 20, height: 10 }),
      { width: 40, height: 20 },
    );
    sendMouseEvent({ button: 'left', col: 1, row: 1 });
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe('onClick bubbling', () => {
  it('fires both inner and outer handlers', () => {
    const outer = vi.fn();
    const inner = vi.fn();
    const { sendMouseEvent } = mountWithInput(
      null,
      () =>
        createElement(
          Box,
          { onClick: outer, width: 20, height: 10 },
          createElement(Box, { onClick: inner, width: 10, height: 5 }),
        ),
      { width: 40, height: 20 },
    );
    sendMouseEvent({ button: 'left', col: 1, row: 1 });
    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).toHaveBeenCalledTimes(1);
  });

  it('inner handler fires before outer (deepest-first bubbling)', () => {
    const order: string[] = [];
    const { sendMouseEvent } = mountWithInput(
      null,
      () =>
        createElement(
          Box,
          { onClick: () => order.push('outer'), width: 20, height: 10 },
          createElement(Box, { onClick: () => order.push('inner'), width: 10, height: 5 }),
        ),
      { width: 40, height: 20 },
    );
    sendMouseEvent({ button: 'left', col: 1, row: 1 });
    expect(order).toEqual(['inner', 'outer']);
  });

  it('stopPropagation prevents outer from firing', () => {
    const outer = vi.fn();
    const inner = vi.fn((e: MouseEvent) => e.stopPropagation());
    const { sendMouseEvent } = mountWithInput(
      null,
      () =>
        createElement(
          Box,
          { onClick: outer, width: 20, height: 10 },
          createElement(Box, { onClick: inner, width: 10, height: 5 }),
        ),
      { width: 40, height: 20 },
    );
    sendMouseEvent({ button: 'left', col: 1, row: 1 });
    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
  });
});

describe('onWheel on <Box>', () => {
  it('fires onWheel for wheel-up', () => {
    const handler = vi.fn();
    const { sendMouseEvent } = mountWithInput(
      null,
      () => createElement(Box, { onWheel: handler, width: 20, height: 10 }),
      { width: 40, height: 20 },
    );
    sendMouseEvent({ button: 'wheel-up', col: 1, row: 1 });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]![0].button).toBe('wheel-up');
  });

  it('fires onWheel for wheel-down', () => {
    const handler = vi.fn();
    const { sendMouseEvent } = mountWithInput(
      null,
      () => createElement(Box, { onWheel: handler, width: 20, height: 10 }),
      { width: 40, height: 20 },
    );
    sendMouseEvent({ button: 'wheel-down', col: 1, row: 1 });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]![0].button).toBe('wheel-down');
  });

  it('does not fire onClick for a wheel event', () => {
    const clickHandler = vi.fn();
    const wheelHandler = vi.fn();
    const { sendMouseEvent } = mountWithInput(
      null,
      () =>
        createElement(Box, { onClick: clickHandler, onWheel: wheelHandler, width: 20, height: 10 }),
      { width: 40, height: 20 },
    );
    sendMouseEvent({ button: 'wheel-up', col: 1, row: 1 });
    expect(clickHandler).not.toHaveBeenCalled();
    expect(wheelHandler).toHaveBeenCalledTimes(1);
  });

  it('does not fire onWheel for a left-click', () => {
    const wheelHandler = vi.fn();
    const { sendMouseEvent } = mountWithInput(
      null,
      () => createElement(Box, { onWheel: wheelHandler, width: 20, height: 10 }),
      { width: 40, height: 20 },
    );
    sendMouseEvent({ button: 'left', col: 1, row: 1 });
    expect(wheelHandler).not.toHaveBeenCalled();
  });
});
