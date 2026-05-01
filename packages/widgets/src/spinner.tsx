import { Text } from '@pilates/react';
import { type JSX, useEffect, useState } from 'react';
import { SPINNER_FRAMES, type SpinnerType } from './spinner-frames.js';

export interface SpinnerProps {
  /** Default 'dots'. Ignored if `frames` is provided. */
  type?: SpinnerType;
  /** Custom frame array. Overrides `type`. */
  frames?: readonly string[];
  /** Milliseconds between frames. Default 80. */
  interval?: number;
}

export function Spinner({ type = 'dots', frames, interval = 80 }: SpinnerProps): JSX.Element {
  const effectiveFrames = frames ?? SPINNER_FRAMES[type];
  const [index, setIndex] = useState(0);

  useEffect(() => {
    setIndex(0);
    if (effectiveFrames.length <= 1) return;
    const id = setInterval(() => {
      setIndex((i) => (i + 1) % effectiveFrames.length);
    }, interval);
    return () => {
      clearInterval(id);
    };
  }, [effectiveFrames, interval]);

  return <Text>{effectiveFrames[index] ?? ''}</Text>;
}
