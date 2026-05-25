/**
 * Direct factory-shape tests for `<Box>`, `<Text>`, `<Spacer>`, `<Newline>`.
 *
 * Render-layer integration is already covered by `render.test.tsx`. These
 * tests pin the lower-level invariants — host-element type, prop
 * forwarding, the Spacer flexGrow:1 contract, and Newline's literal '\n'
 * value — so a refactor that swaps the host-element strings or drops
 * Spacer's flexGrow can't slip past CI.
 */

import { isValidElement } from 'react';
import { describe, expect, it } from 'vitest';
import { Box, Newline, Spacer, Text } from './components.js';

describe('Box', () => {
  it('produces a `pilates-box` element', () => {
    const el = Box({});
    expect(isValidElement(el)).toBe(true);
    expect(el.type).toBe('pilates-box');
  });

  it('forwards layout, border, and event props verbatim', () => {
    const onClick = () => {};
    const el = Box({
      width: 10,
      height: 4,
      flexDirection: 'row',
      border: 'rounded',
      borderColor: 'cyan',
      padding: 1,
      onClick,
    });
    expect(el.props).toEqual(
      expect.objectContaining({
        width: 10,
        height: 4,
        flexDirection: 'row',
        border: 'rounded',
        borderColor: 'cyan',
        padding: 1,
        onClick,
      }),
    );
  });

  it('forwards children through unchanged', () => {
    const child = Text({ children: 'hi' });
    const el = Box({ children: child });
    expect(el.props.children).toBe(child);
  });
});

describe('Text', () => {
  it('produces a `pilates-text` element', () => {
    const el = Text({});
    expect(isValidElement(el)).toBe(true);
    expect(el.type).toBe('pilates-text');
  });

  it('forwards TextStyle props verbatim', () => {
    const el = Text({
      color: 'red',
      bgColor: 'yellow',
      bold: true,
      italic: true,
      underline: true,
      dim: true,
      inverse: true,
      wrap: 'truncate',
      children: 'hello',
    });
    expect(el.props).toEqual(
      expect.objectContaining({
        color: 'red',
        bgColor: 'yellow',
        bold: true,
        italic: true,
        underline: true,
        dim: true,
        inverse: true,
        wrap: 'truncate',
        children: 'hello',
      }),
    );
  });
});

describe('Spacer', () => {
  it('produces a `pilates-box` element with flexGrow:1', () => {
    const el = Spacer();
    expect(el.type).toBe('pilates-box');
    expect(el.props).toEqual({ flexGrow: 1 });
  });
});

describe('Newline', () => {
  it('is exactly a single line-feed string', () => {
    expect(Newline()).toBe('\n');
    // Not a React element — it's a string by design so it interpolates
    // directly into Text children.
    expect(typeof Newline()).toBe('string');
  });
});
