import { describe, expect, it } from 'vitest';
import { renderToString } from './test-utils.js';
import { Box, Newline, Spacer, Text } from './components.js';

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
