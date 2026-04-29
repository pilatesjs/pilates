/**
 * Public types for the declarative render API.
 *
 * A `RenderNode` is either a *container* (with optional children) or a *text*
 * leaf (with a `text` property). Both share the layout property surface that
 * mirrors `@pilates/core`'s setters, expressed as plain object fields.
 *
 * Styling is NOT inherited in v1: every text leaf carries its own color /
 * attrs. Future versions may add inheritance via context.
 */

/**
 * Named ANSI colors plus 24-bit hex strings ('#ff5500') plus 256-color palette
 * indices (0-255).
 */
export type Color = NamedColor | `#${string}` | number;

export type NamedColor =
  | 'black'
  | 'red'
  | 'green'
  | 'yellow'
  | 'blue'
  | 'magenta'
  | 'cyan'
  | 'white'
  | 'gray'
  | 'brightRed'
  | 'brightGreen'
  | 'brightYellow'
  | 'brightBlue'
  | 'brightMagenta'
  | 'brightCyan'
  | 'brightWhite';

export type BorderStyle = 'none' | 'single' | 'double' | 'rounded' | 'bold';

export type FlexDirection = 'row' | 'column' | 'row-reverse' | 'column-reverse';
export type FlexWrap = 'nowrap' | 'wrap' | 'wrap-reverse';
export type Justify =
  | 'flex-start'
  | 'flex-end'
  | 'center'
  | 'space-between'
  | 'space-around'
  | 'space-evenly';
export type Align =
  | 'auto'
  | 'flex-start'
  | 'flex-end'
  | 'center'
  | 'stretch'
  | 'space-between'
  | 'space-around';
export type PositionType = 'relative' | 'absolute';
export type Display = 'flex' | 'none';

/**
 * Shorthand or per-edge specification for box props (padding, margin, position).
 */
export type EdgeValue =
  | number
  | {
      top?: number;
      right?: number;
      bottom?: number;
      left?: number;
    };

export interface LayoutProps {
  flexDirection?: FlexDirection;
  flexWrap?: FlexWrap;
  flex?: number;
  flexGrow?: number;
  flexShrink?: number;
  flexBasis?: number | 'auto';
  width?: number | 'auto';
  height?: number | 'auto';
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  padding?: EdgeValue;
  margin?: EdgeValue;
  gap?: number | { row?: number; column?: number };
  justifyContent?: Justify;
  alignItems?: Align;
  alignSelf?: Align;
  alignContent?: Align;
  positionType?: PositionType;
  position?: {
    top?: number;
    right?: number;
    bottom?: number;
    left?: number;
  };
  display?: Display;
}

/** Visual attributes for borders / text. */
export interface TextStyle {
  color?: Color;
  bgColor?: Color;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  dim?: boolean;
  inverse?: boolean;
}

export interface BorderProps {
  border?: BorderStyle;
  borderColor?: Color;
  /** A short string rendered inline at the top border. Truncated to fit. */
  title?: string;
  titleColor?: Color;
}

export type Wrap = 'wrap' | 'truncate' | 'none';

export interface ContainerNode extends LayoutProps, BorderProps {
  /** Children of this container. */
  children?: RenderNode[];
  /** Optional background fill for the inner area (currently unused — v2). */
}

export interface TextNode extends LayoutProps, TextStyle {
  /** The literal text to render. `\n` forces a hard line break. */
  text: string;
  /** How to handle text that does not fit on one line. Defaults to `'wrap'`. */
  wrap?: Wrap;
}

export type RenderNode = ContainerNode | TextNode;

/** Options for `render()`. */
export interface RenderOptions {
  /**
   * If `false`, ANSI escape sequences are stripped from the output regardless
   * of TTY detection. Defaults to `process.stdout.isTTY` when running under
   * Node, or `true` otherwise.
   */
  ansi?: boolean;
}

export function isTextNode(node: RenderNode): node is TextNode {
  return typeof (node as TextNode).text === 'string';
}
