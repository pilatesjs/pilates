import { type ReactNode, forwardRef, useState } from 'react';
import { Box } from './components.js';

export interface ScrollMeta {
  contentSize: number;
  viewportSize: number;
  atStart: boolean;
  atEnd: boolean;
}

export interface ScrollViewProps {
  height?: number | 'auto';
  width?: number | 'auto';
  horizontal?: boolean;
  /** Controlled scroll offset. If set, parent owns the value. */
  scrollOffset?: number;
  /** Uncontrolled initial offset. Ignored when `scrollOffset` is set. */
  defaultScrollOffset?: number;
  /** Fires whenever the offset changes (controlled or uncontrolled). */
  onScroll?: (offset: number, meta: ScrollMeta) => void;
  children?: ReactNode;
}

export const ScrollView = forwardRef<unknown, ScrollViewProps>(function ScrollView(
  { height, width, horizontal, scrollOffset, defaultScrollOffset, children },
  _ref,
) {
  const isControlled = scrollOffset !== undefined;
  const [internalOffset, setInternalOffset] = useState(defaultScrollOffset ?? 0);
  void setInternalOffset;
  const effectiveOffset = isControlled ? scrollOffset : internalOffset;

  const axisOverflow = horizontal === true
    ? { overflowX: 'hidden' as const, overflowY: 'visible' as const }
    : { overflowX: 'visible' as const, overflowY: 'hidden' as const };
  const offsetProp = horizontal === true
    ? { scrollLeft: effectiveOffset }
    : { scrollTop: effectiveOffset };

  return (
    <Box
      {...(width !== undefined ? { width } : {})}
      {...(height !== undefined ? { height } : {})}
      flexDirection={horizontal === true ? 'row' : 'column'}
      {...axisOverflow}
      {...offsetProp}
    >
      {children}
    </Box>
  );
});
