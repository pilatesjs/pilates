export const VERSION = '0.2.1';

// Public components
export { Box, Newline, Spacer, Text } from './components.js';
export type { BoxProps, TextProps } from './components.js';

// Hooks
export { useApp, useInput, usePaste, useStdout, useStderr, useWindowSize } from './hooks.js';
export type {
  AppHookValue,
  KeyEvent,
  KeyName,
  StderrHookValue,
  StdoutHookValue,
  UseInputOptions,
} from './hooks.js';

export { useFocus, useFocusManager } from './focus.js';
export type {
  FocusProviderProps,
  UseFocusOptions,
  UseFocusValue,
  UseFocusManagerValue,
} from './focus.js';

export { ErrorBoundary } from './error-boundary.js';
export type {
  ErrorBoundaryProps,
  ErrorBoundaryFallback,
  ErrorBoundaryFallbackProps,
  ErrorBoundaryInfo,
} from './error-boundary.js';

export { ThemeProvider, useTheme, defaultTheme, lightTheme } from './theme.js';
export type { Theme, ThemeProviderProps } from './theme.js';

export { useBoxMetrics } from './use-box-metrics.js';
export type { BoxMetrics } from './use-box-metrics.js';

// Render entry
export { render } from './render.js';
export type { RenderOptions, RenderInstance } from './render.js';

// Type re-exports from @pilates/render so consumers get one import path
export type {
  Align,
  BorderStyle,
  Color,
  EdgeValue,
  FlexDirection,
  FlexWrap,
  Justify,
  NamedColor,
  PositionType,
  Wrap,
} from '@pilates/render';

// Error infrastructure (Phase 1)
export {
  PILATES_ERROR_HINTS,
  PilatesError,
  PilatesErrorCode,
  didYouMean,
  formatPilatesError,
  isPilatesError,
  suggestHostTypeReplacement,
} from './errors/index.js';
export type {
  HostTypeSuggestion,
  PilatesErrorJSON,
  PilatesErrorOptions,
} from './errors/index.js';
