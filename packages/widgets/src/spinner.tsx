import { Text } from '@pilates/react';
import { type JSX, useEffect, useRef, useState } from 'react';
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

  // Idiomatic JSX passes inline arrays — `<Spinner frames={['a','b']} />` —
  // which create a fresh reference on every parent render. Depending on the
  // array identity would clear the interval and reset `index` to 0 on each
  // re-render, freezing the visible frame. Key the effect off the frames'
  // CONTENT so it only re-fires when the frame set actually changes. Read
  // the latest array via a ref so the running interval picks up content
  // changes that share the same length too (rare but possible).
  const framesKey = effectiveFrames.join('\x00');
  const framesRef = useRef(effectiveFrames);
  framesRef.current = effectiveFrames;

  // biome-ignore lint/correctness/useExhaustiveDependencies: framesKey is a content-hash trigger, not a value read inside the effect — see comment above.
  useEffect(() => {
    setIndex(0);
    const length = framesRef.current.length;
    if (length <= 1) return;
    const id = setInterval(() => {
      setIndex((i) => (i + 1) % framesRef.current.length);
    }, interval);
    return () => {
      clearInterval(id);
    };
  }, [framesKey, interval]);

  return <Text>{effectiveFrames[index] ?? ''}</Text>;
}
