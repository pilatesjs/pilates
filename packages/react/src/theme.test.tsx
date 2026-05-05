import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { Box, Text } from './components.js';
import { mountWithInput } from './test-utils.js';
import { type Theme, ThemeProvider, defaultTheme, lightTheme, useTheme } from './theme.js';

const opts = { width: 20, height: 1 };

describe('useTheme — defaults', () => {
  it('returns defaultTheme when no <ThemeProvider> wraps the consumer', () => {
    let captured: Theme | null = null;
    function App() {
      captured = useTheme();
      return null;
    }
    const handle = mountWithInput(0, () => <App />, opts);
    expect(captured).toEqual(defaultTheme);
    handle.unmount();
  });

  it('defaultTheme has every documented semantic token', () => {
    const required: (keyof Theme)[] = [
      'primary',
      'accent',
      'text',
      'muted',
      'success',
      'warning',
      'error',
      'info',
      'border',
    ];
    for (const k of required) {
      expect(defaultTheme[k]).toBeDefined();
    }
  });

  it('lightTheme has every documented semantic token', () => {
    const required: (keyof Theme)[] = [
      'primary',
      'accent',
      'text',
      'muted',
      'success',
      'warning',
      'error',
      'info',
      'border',
    ];
    for (const k of required) {
      expect(lightTheme[k]).toBeDefined();
    }
  });
});

describe('ThemeProvider — full theme override', () => {
  it('useTheme returns the provided theme', () => {
    const custom: Theme = { ...defaultTheme, primary: 'magenta', error: 'yellow' };
    let captured: Theme | null = null;
    function Inner() {
      captured = useTheme();
      return null;
    }
    const handle = mountWithInput(
      0,
      () => (
        <ThemeProvider theme={custom}>
          <Inner />
        </ThemeProvider>
      ),
      opts,
    );
    expect(captured).toEqual(custom);
    handle.unmount();
  });
});

describe('ThemeProvider — partial override', () => {
  it('merges a partial override on top of the parent theme', () => {
    let captured: Theme | null = null;
    function Inner() {
      captured = useTheme();
      return null;
    }
    const handle = mountWithInput(
      0,
      () => (
        <ThemeProvider theme={{ primary: 'magenta' }}>
          <Inner />
        </ThemeProvider>
      ),
      opts,
    );
    // primary overridden, every other token from defaultTheme
    expect(captured?.primary).toBe('magenta');
    expect(captured?.error).toBe(defaultTheme.error);
    expect(captured?.success).toBe(defaultTheme.success);
    handle.unmount();
  });

  it('a nested ThemeProvider merges over the outer one', () => {
    let captured: Theme | null = null;
    function Inner() {
      captured = useTheme();
      return null;
    }
    const handle = mountWithInput(
      0,
      () => (
        <ThemeProvider theme={{ primary: 'magenta', error: 'red' }}>
          <ThemeProvider theme={{ error: 'yellow' }}>
            <Inner />
          </ThemeProvider>
        </ThemeProvider>
      ),
      opts,
    );
    // primary inherited from outer; error overridden by inner
    expect(captured?.primary).toBe('magenta');
    expect(captured?.error).toBe('yellow');
    handle.unmount();
  });
});

describe('useTheme — usage in rendered output', () => {
  it('a Text component reading theme.primary applies that color', () => {
    function Themed() {
      const t = useTheme();
      return <Text color={t.primary}>hi</Text>;
    }
    const handle = mountWithInput(
      0,
      () => (
        <ThemeProvider theme={{ primary: 'cyan' }}>
          <Themed />
        </ThemeProvider>
      ),
      opts,
    );
    // SGR 36 = cyan foreground
    // biome-ignore lint/suspicious/noControlCharactersInRegex: ESC (0x1b) is exactly what we want to match
    expect(handle.lastWrite()).toMatch(/\x1b\[[0-9;]*36m/);
    handle.unmount();
  });

  it('changing theme prop is observable via useTheme on the next commit', () => {
    // Asserting via captured useTheme values rather than rendered SGR sidesteps
    // the @pilates/diff equivalence check — if the visible cell content is
    // identical and only the color SGR changes, the diff still re-emits, but
    // verifying the propagation through the provider is the contract we
    // actually want to test here.
    const seen: string[] = [];
    function Themed() {
      const t = useTheme();
      seen.push(String(t.primary));
      return <Text color={t.primary}>hi</Text>;
    }
    function Driver({ phase }: { phase: 1 | 2 }) {
      const theme = phase === 1 ? { primary: 'cyan' as const } : { primary: 'red' as const };
      return (
        <ThemeProvider theme={theme}>
          <Themed />
        </ThemeProvider>
      );
    }
    const handle = mountWithInput<1 | 2>(1, (s) => <Driver phase={s} />, opts);
    handle.setState(2);
    expect(seen).toContain('cyan');
    expect(seen).toContain('red');
    handle.unmount();
  });
});

// Reference Box so the import isn't tree-shaken — we don't render with it
// in the focused tests above, but consumers commonly compose with it.
void Box;
