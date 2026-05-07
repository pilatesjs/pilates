import { describe, expect, it } from 'vitest';
import { Box, Text } from './components.js';
import { renderToString } from './test-utils.js';

// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI escapes
const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '').replace(/\x1b\[[0-9;]*[Hf]/g, '');

describe('<Box> overflow props', () => {
  it('accepts overflow="hidden" without type errors', () => {
    // This is a compile-time + runtime acceptance test: the prop must be accepted
    // by BoxProps and reach the render node without throwing.
    const out = stripAnsi(
      renderToString(
        <Box width={10} height={2} overflow="hidden">
          <Text>hello</Text>
        </Box>,
        { width: 10, height: 2 },
      ),
    );
    expect(out).toContain('hello');
  });

  it('accepts overflowX and overflowY', () => {
    const out = stripAnsi(
      renderToString(
        <Box width={10} height={2} overflowX="scroll" overflowY="hidden">
          <Text>hello</Text>
        </Box>,
        { width: 10, height: 2 },
      ),
    );
    expect(out).toContain('hello');
  });

  it('accepts overflow="scroll"', () => {
    const out = stripAnsi(
      renderToString(
        <Box width={10} height={3} overflow="scroll">
          <Text>row0</Text>
          <Text>row1</Text>
        </Box>,
        { width: 10, height: 3 },
      ),
    );
    expect(out).toContain('row0');
  });

  it('accepts overflow="auto"', () => {
    const out = stripAnsi(
      renderToString(
        <Box width={10} height={3} overflow="auto">
          <Text>row0</Text>
        </Box>,
        { width: 10, height: 3 },
      ),
    );
    expect(out).toContain('row0');
  });
});
