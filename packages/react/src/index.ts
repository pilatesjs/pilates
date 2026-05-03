export const VERSION = '0.2.1';

// Public components
export { Box, Newline, Spacer, Text } from './components.js';
export type { BoxProps, TextProps } from './components.js';

// Hooks
export { useApp, useInput, useStdout, useStderr, useWindowSize } from './hooks.js';
export type {
  AppHookValue,
  KeyEvent,
  KeyName,
  StderrHookValue,
  StdoutHookValue,
  UseInputOptions,
} from './hooks.js';

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
