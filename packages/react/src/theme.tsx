import type { Color } from '@pilates/render';
import { type ReactNode, createContext, createElement, useContext, useMemo } from 'react';

/**
 * Semantic color tokens for the Pilates theme system. Each token names an
 * intent (`primary`, `error`, etc.) — the actual color it resolves to is
 * controlled by the active `<ThemeProvider>` (or `defaultTheme` when none
 * wraps the consumer).
 *
 * Keep the token set tight. Adding semantic intents that real apps need
 * is cheap; adding cosmetic variants is hard to undo. v1 ships the nine
 * tokens below; theming-aware widgets in `@pilates/widgets` will land in
 * a follow-up that opts into specific tokens.
 */
export interface Theme {
  /** Brand main — active tab, primary CTA, focused field marker. */
  primary: Color;
  /** Brand secondary — hover-equivalent, supplementary highlights. */
  accent: Color;
  /** Default body text. */
  text: Color;
  /** De-emphasized text (placeholders, disabled rows, captions). */
  muted: Color;
  /** Positive state — confirmations, success banners. */
  success: Color;
  /** Caution state — warnings, lossy operations. */
  warning: Color;
  /** Error state — failures, destructive actions. */
  error: Color;
  /** Informational — neutral notifications, hints. */
  info: Color;
  /** Box / panel borders. */
  border: Color;
}

/**
 * Default theme — tuned for dark terminals (the Linux / macOS default and
 * what most TUI users run). Colors are named ANSI so they pick up the
 * user's terminal palette overrides.
 */
export const defaultTheme: Theme = {
  primary: 'cyan',
  accent: 'magenta',
  text: 'white',
  muted: 'gray',
  success: 'green',
  warning: 'yellow',
  error: 'red',
  info: 'blue',
  border: 'white',
};

/**
 * Light-terminal variant — same intents, palette adjusted for legibility on
 * light backgrounds. `text` becomes black; `muted` darkens; saturated
 * variants of the accent colors give better contrast against white.
 */
export const lightTheme: Theme = {
  primary: 'blue',
  accent: 'magenta',
  text: 'black',
  muted: 'gray',
  success: 'green',
  warning: 'yellow',
  error: 'red',
  info: 'cyan',
  border: 'black',
};

const ThemeContext = createContext<Theme | null>(null);

export interface ThemeProviderProps {
  /**
   * Either a full `Theme` object or a partial override. Partial overrides
   * merge on top of the parent theme (or `defaultTheme` if no parent
   * provider is present), so consumers can change one or two tokens
   * without re-stating the rest.
   */
  theme: Theme | Partial<Theme>;
  children?: ReactNode;
}

/**
 * Wrap a subtree in `<ThemeProvider>` to override the active theme. Nested
 * providers compose — the inner override merges over the outer.
 *
 *     <ThemeProvider theme={lightTheme}>
 *       <App />
 *       <ThemeProvider theme={{ error: 'red' }}>
 *         <DangerZone />
 *       </ThemeProvider>
 *     </ThemeProvider>
 */
export function ThemeProvider({ theme, children }: ThemeProviderProps) {
  const parent = useContext(ThemeContext) ?? defaultTheme;
  // Memoize the merged theme so descendant `useTheme()` consumers see a
  // stable reference across parent re-renders that don't change tokens.
  const merged = useMemo(() => ({ ...parent, ...theme }), [parent, theme]);
  return createElement(ThemeContext.Provider, { value: merged }, children);
}

/**
 * Read the active theme. Returns `defaultTheme` when no `<ThemeProvider>`
 * wraps the caller — theming is opt-in, so simple apps can call this
 * freely without adding a provider.
 */
export function useTheme(): Theme {
  return useContext(ThemeContext) ?? defaultTheme;
}
