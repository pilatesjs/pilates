import { Box, type Color, Text } from '@pilates/react';
import { type JSX, useEffect, useRef, useState } from 'react';

export interface ProgressBarProps {
  /** Current value. Clamped to `[0, total]`. Ignored when `indeterminate` is true. */
  value?: number;
  /** Total value. Default 100. Values <= 0 render as fully empty. */
  total?: number;
  /** Bar width in terminal cells. Default 20. */
  width?: number;
  /** Filled-section character. Default `'█'`. Single grapheme assumed. */
  fillChar?: string;
  /** Empty-section character. Default `'░'`. Single grapheme assumed. */
  emptyChar?: string;
  /** Color applied to filled cells. */
  color?: Color;
  /** Color applied to empty cells. */
  trackColor?: Color;
  /** When true, animates a bouncing scanner instead of using `value`/`total`. */
  indeterminate?: boolean;
  /** Indeterminate scanner step interval in ms. Default 80. */
  interval?: number;
  /** Indeterminate scanner cell width. Default 3, clamped to `[1, width]`. */
  scannerWidth?: number;
}

const ROW: { flexDirection: 'row'; height: 1 } = { flexDirection: 'row', height: 1 };

function determinateFilledCells(value: number, total: number, width: number): number {
  if (width <= 0 || total <= 0) return 0;
  const clamped = Math.max(0, Math.min(value, total));
  return Math.round((clamped / total) * width);
}

// Spread `color` only when defined — `exactOptionalPropertyTypes` rejects an
// explicit `color={undefined}` on `<Text>`, but accepts the key being absent.
function colorProp(color: Color | undefined): { color?: Color } {
  return color !== undefined ? { color } : {};
}

export function ProgressBar({
  value = 0,
  total = 100,
  width = 20,
  fillChar = '█',
  emptyChar = '░',
  color,
  trackColor,
  indeterminate = false,
  interval = 80,
  scannerWidth = 3,
}: ProgressBarProps): JSX.Element {
  const safeWidth = Math.max(0, Math.floor(width));
  const safeScanner = Math.max(1, Math.min(Math.floor(scannerWidth), safeWidth || 1));
  const travel = Math.max(1, safeWidth - safeScanner + 1);

  const [scanIndex, setScanIndex] = useState(0);
  const directionRef = useRef<1 | -1>(1);

  // Reset and re-arm the scanner whenever the indeterminate path is active
  // and any of its sizing inputs change. Pinning the dep on the derived
  // travel distance avoids re-arming on cosmetic prop changes (color, etc.).
  useEffect(() => {
    if (!indeterminate) return;
    setScanIndex(0);
    directionRef.current = 1;
    if (travel <= 1) return;
    const id = setInterval(() => {
      setScanIndex((i) => {
        let next = i + directionRef.current;
        if (next >= travel - 1) {
          next = travel - 1;
          directionRef.current = -1;
        } else if (next <= 0) {
          next = 0;
          directionRef.current = 1;
        }
        return next;
      });
    }, interval);
    return () => {
      clearInterval(id);
    };
  }, [indeterminate, interval, travel]);

  if (safeWidth === 0) return <Box width={0} height={1} />;

  const fillStyle = colorProp(color);
  const trackStyle = colorProp(trackColor);

  if (indeterminate) {
    const left = scanIndex;
    const scan = safeScanner;
    const right = Math.max(0, safeWidth - scan - left);
    return (
      <Box {...ROW} width={safeWidth}>
        {left > 0 && <Text {...trackStyle}>{emptyChar.repeat(left)}</Text>}
        <Text {...fillStyle}>{fillChar.repeat(scan)}</Text>
        {right > 0 && <Text {...trackStyle}>{emptyChar.repeat(right)}</Text>}
      </Box>
    );
  }

  const filled = determinateFilledCells(value, total, safeWidth);
  const empty = safeWidth - filled;
  return (
    <Box {...ROW} width={safeWidth}>
      {filled > 0 && <Text {...fillStyle}>{fillChar.repeat(filled)}</Text>}
      {empty > 0 && <Text {...trackStyle}>{emptyChar.repeat(empty)}</Text>}
    </Box>
  );
}
