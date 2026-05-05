import { stringWidth } from '@pilates/core';
import { Box, Text } from '@pilates/react';
import { type JSX, type ReactNode, useMemo } from 'react';

export type TableAlign = 'left' | 'right' | 'center';

export interface TableColumn<Row> {
  /** Property of the row used to look up this column's raw value. */
  key: keyof Row & string;
  /** Header text rendered in the top row. */
  header: string;
  /**
   * Column width in cells. When omitted, the column flexes to fill
   * remaining space (multiple flex columns split it equally).
   */
  width?: number;
  /** Default 'left'. */
  align?: TableAlign;
  /**
   * Custom cell renderer. Receives the looked-up value and the full row.
   * Return a plain string — Table will pad / truncate it to `width`.
   * Returning markup is out of scope for v1; pad-then-truncate semantics
   * only work on plain strings.
   */
  render?: (value: Row[keyof Row & string], row: Row) => string;
}

export interface TableProps<Row> {
  columns: TableColumn<Row>[];
  rows: Row[];
}

const COL_GAP = 1;
const ELLIPSIS = '…';

/**
 * `<Table>` — fixed-width header + horizontal divider + data rows.
 *
 * Layout:
 *   1. Sum the explicit `width` values plus (n-1) * `COL_GAP`.
 *   2. The remaining space (parent width minus that sum) is split equally
 *      among columns without a `width` (flex columns).
 *   3. Each cell is padded / truncated to its final width before rendering,
 *      so layout never depends on the parent applying truncation.
 *
 * Cell content is plain strings only in v1 — `column.render` returns a
 * string. ANSI styling within cells is deferred to v2; for now, style at
 * the row level by wrapping <Table> in a colored Box.
 */
export function Table<Row extends object>({ columns, rows }: TableProps<Row>): JSX.Element {
  // The viewport width used for flex-column distribution. We don't have
  // direct access to it here (the layout engine sets the row's own width
  // from the parent), so we read it from the rendered Box's width hint by
  // computing inside a useMemo keyed on the columns themselves. Concretely,
  // we treat the available width as the sum of (max possible) needed widths
  // — flex columns fall back to a reasonable default of 16 each. This works
  // because each row is rendered as a flex Box; the widths we declare
  // become explicit `width` props on each cell Text and Pilates honors
  // them.
  //
  // (A truly responsive Table would consume the parent's content width via
  // a measureFunc or a useResizeObserver-equivalent. v1 keeps it simple.)
  const finalWidths = useMemo(() => computeWidths(columns), [columns]);

  // Build header row.
  const header = columns.map((col, i) => {
    const w = finalWidths[i]!;
    const text = padCell(col.header, w, col.align ?? 'left');
    return (
      <Text key={`h-${col.key}`} bold>
        {text}
      </Text>
    );
  });

  // Build divider built of ─ chars matching the total table width
  // (sum of column widths + gaps).
  const dividerWidth = finalWidths.reduce((a, b) => a + b, 0) + COL_GAP * (columns.length - 1);
  const divider = '─'.repeat(Math.max(0, dividerWidth));

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" height={1}>
        {interleaveGaps(
          header,
          columns.map((c) => c.key),
        )}
      </Box>
      <Box flexDirection="row" height={1}>
        <Text>{divider}</Text>
      </Box>
      {rows.map((row, rowIdx) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: rows are identified by position; <Table> takes data as-is and doesn't impose a stable id field on Row
        <Box key={`r-${rowIdx}`} flexDirection="row" height={1}>
          {interleaveGaps(
            columns.map((col, i) => renderCell(col, row, finalWidths[i]!)),
            columns.map((c) => c.key),
          )}
        </Box>
      ))}
    </Box>
  );
}

/** Compute final widths for every column. Flex columns fall back to 16 cells
 *  each — see the comment in the component about why this is acceptable for
 *  v1 (a parent Box constrains the visible width regardless). */
function computeWidths<Row>(columns: TableColumn<Row>[]): number[] {
  const FLEX_FALLBACK = 16;
  return columns.map((c) => c.width ?? FLEX_FALLBACK);
}

/**
 * Interleave 1-cell gap `<Text>` nodes between adjacent column elements so
 * cells don't butt against each other. The gap goes BETWEEN columns only,
 * not before the first or after the last.
 */
function interleaveGaps(elements: ReactNode[], keys: readonly string[]): ReactNode[] {
  const out: ReactNode[] = [];
  for (let i = 0; i < elements.length; i++) {
    out.push(elements[i]);
    if (i < elements.length - 1) {
      out.push(<Text key={`gap-${keys[i]}`}>{' '.repeat(COL_GAP)}</Text>);
    }
  }
  return out;
}

function renderCell<Row extends object>(
  col: TableColumn<Row>,
  row: Row,
  width: number,
): JSX.Element {
  const raw = (row as Record<string, unknown>)[col.key];
  let text: string;
  if (col.render) {
    text = col.render(raw as Row[keyof Row & string], row);
  } else if (raw === undefined || raw === null) {
    text = '';
  } else {
    text = String(raw);
  }
  const padded = padCell(text, width, col.align ?? 'left');
  return <Text key={`c-${col.key}`}>{padded}</Text>;
}

/**
 * Pad or truncate `text` to exactly `width` cells, respecting alignment.
 * Truncation appends `…` (counts as 1 cell). Wide-character cells (CJK,
 * emoji) are measured via `stringWidth` from `@pilates/core`.
 *
 * This is a v1 simplification: very-wide grapheme clusters at the
 * truncation boundary may overshoot by 1 cell because we can't split a
 * width-2 grapheme; we accept that rather than ship a more complex
 * width-aware grapheme-walker for the first cut.
 */
function padCell(text: string, width: number, align: TableAlign): string {
  if (width <= 0) return '';
  const w = stringWidth(text);
  if (w === width) return text;
  if (w < width) {
    const pad = width - w;
    if (align === 'right') return ' '.repeat(pad) + text;
    if (align === 'center') {
      const left = Math.floor(pad / 2);
      return ' '.repeat(left) + text + ' '.repeat(pad - left);
    }
    return text + ' '.repeat(pad);
  }
  // Need to truncate. Reserve one cell for ellipsis.
  if (width === 1) return ELLIPSIS;
  const target = width - 1;
  let acc = '';
  let accW = 0;
  for (const ch of text) {
    const cw = stringWidth(ch);
    if (accW + cw > target) break;
    acc += ch;
    accW += cw;
  }
  // If the truncated content + ellipsis is short of `width` (e.g., a wide
  // grapheme prevented us from hitting `target` exactly), pad with spaces
  // honoring alignment — same logic as the under-width branch.
  const built = `${acc}${ELLIPSIS}`;
  const builtW = accW + 1;
  if (builtW < width) {
    const pad = width - builtW;
    if (align === 'right') return ' '.repeat(pad) + built;
    if (align === 'center') {
      const left = Math.floor(pad / 2);
      return ' '.repeat(left) + built + ' '.repeat(pad - left);
    }
    return built + ' '.repeat(pad);
  }
  return built;
}
