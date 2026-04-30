import { createElement, type JSX, type ReactNode } from 'react';
import type { BorderProps, LayoutProps, TextStyle, Wrap } from '@pilates/render';

/* eslint-disable @typescript-eslint/no-namespace */
declare global {
  namespace JSX {
    interface IntrinsicElements {
      'pilates-box': BoxProps & { children?: ReactNode };
      'pilates-text': TextProps & { children?: ReactNode };
    }
  }
}

export type BoxProps = LayoutProps &
  BorderProps & {
    children?: ReactNode;
  };

export type TextProps = TextStyle & {
  wrap?: Wrap;
  children?: ReactNode;
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
