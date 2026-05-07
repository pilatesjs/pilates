import { type ReactNode, forwardRef } from 'react';
import { Box } from './components.js';

export interface ScrollViewProps {
  /** Visible viewport height (cells). Required for vertical scrolling. */
  height?: number | 'auto';
  /** Visible viewport width (cells). Required for horizontal scrolling. */
  width?: number | 'auto';
  /** When true, scroll the X axis instead of Y. Default false (vertical). */
  horizontal?: boolean;
  children?: ReactNode;
}

export const ScrollView = forwardRef<unknown, ScrollViewProps>(function ScrollView(
  { height, width, horizontal, children },
  _ref,
) {
  return (
    <Box
      {...(width !== undefined ? { width } : {})}
      {...(height !== undefined ? { height } : {})}
      overflow="hidden"
      flexDirection={horizontal === true ? 'row' : 'column'}
    >
      {children}
    </Box>
  );
});
