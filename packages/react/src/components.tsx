import type { BorderProps, LayoutProps, TextStyle, Wrap } from '@pilates/render';
import { type JSX, type ReactNode, type Ref, createElement } from 'react';
import type { MouseEvent } from './mouse-event.js';

declare global {
  // biome-ignore lint/suspicious/noRedeclare: augmenting the global JSX namespace
  namespace JSX {
    interface IntrinsicElements {
      // `ref` is part of React's host-element prop set and the reconciler
      // wires it to whatever `getPublicInstance` returns (the BoxInstance /
      // TextInstance from host-config.ts). useBoxMetrics narrows that
      // back at the consumer boundary.
      'pilates-box': BoxProps & { children?: ReactNode; ref?: Ref<unknown> };
      'pilates-text': TextProps & { children?: ReactNode; ref?: Ref<unknown> };
    }
  }
}

export type BoxProps = LayoutProps &
  BorderProps & {
    children?: ReactNode;
    /**
     * Receives the underlying host instance. Pair with `useBoxMetrics(ref)`
     * to read computed layout (left / top / width / height) for this Box.
     */
    ref?: Ref<unknown>;
    onClick?: (event: MouseEvent) => void;
    onWheel?: (event: MouseEvent) => void;
  };

export type TextProps = TextStyle & {
  wrap?: Wrap;
  children?: ReactNode;
  /** Receives the underlying host instance. Rarely needed for `<Text>`. */
  ref?: Ref<unknown>;
};

export function Box(props: BoxProps): JSX.Element {
  return createElement('pilates-box', props);
}

export function Text(props: TextProps): JSX.Element {
  return createElement('pilates-text', props);
}

export function Spacer(): JSX.Element {
  return createElement('pilates-box', { flexGrow: 1 });
}

export function Newline(): string {
  return '\n';
}
