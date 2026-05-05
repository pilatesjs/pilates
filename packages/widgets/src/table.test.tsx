import { renderToString } from '@pilates/react/test-utils';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { Table, type TableColumn } from './table.js';

const opts = { width: 40, height: 6 };

function stripSGR(s: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ESC (0x1b) is exactly what we want to strip
  const noSgr = s.replace(/\x1b\[[0-9;]*m/g, '');
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ESC (0x1b) is exactly what we want to strip
  return noSgr.replace(/\x1b\[[0-9;]*[Hf]/g, '').replace(/\n$/, '');
}

interface Person {
  name: string;
  age: number;
  role: string;
}

const cols: TableColumn<Person>[] = [
  { key: 'name', header: 'Name', width: 8 },
  { key: 'age', header: 'Age', width: 4, align: 'right' },
  { key: 'role', header: 'Role', width: 12 },
];
const rows: Person[] = [
  { name: 'Alice', age: 30, role: 'engineer' },
  { name: 'Bob', age: 25, role: 'designer' },
];

describe('Table rendering', () => {
  it('renders header row, divider, and data rows', () => {
    const out = stripSGR(
      renderToString(createElement(Table<Person>, { columns: cols, rows }), opts),
    );
    const lines = out.split('\n');
    // Row 0 = headers
    expect(lines[0]).toContain('Name');
    expect(lines[0]).toContain('Age');
    expect(lines[0]).toContain('Role');
    // Row 1 = divider built of ─ characters
    expect(lines[1]).toMatch(/^─+/);
    // Rows 2 & 3 = data
    expect(lines[2]).toContain('Alice');
    expect(lines[2]).toContain('30');
    expect(lines[2]).toContain('engineer');
    expect(lines[3]).toContain('Bob');
    expect(lines[3]).toContain('25');
    expect(lines[3]).toContain('designer');
  });

  it('right-aligns columns with align:"right"', () => {
    const out = stripSGR(
      renderToString(createElement(Table<Person>, { columns: cols, rows }), opts),
    );
    const lines = out.split('\n');
    // 'Age' column is width 4, right-aligned. '30' should appear with leading
    // padding so it sits flush against the right edge of its column.
    // Column starts at index 9 (after Name=8 + 1-cell gap), ends at index 12.
    // The cell content "  30" — verify by looking at the substring at indices 9-12.
    const aliceRow = lines[2]!;
    expect(aliceRow.slice(9, 13)).toBe('  30');
  });

  it('left-aligns by default', () => {
    const out = stripSGR(
      renderToString(createElement(Table<Person>, { columns: cols, rows }), opts),
    );
    const aliceRow = out.split('\n')[2]!;
    expect(aliceRow.slice(0, 5)).toBe('Alice');
  });

  it('truncates with ellipsis when value exceeds column width', () => {
    const longCols: TableColumn<{ name: string }>[] = [{ key: 'name', header: 'Name', width: 5 }];
    const longRows = [{ name: 'Bartholomew' }];
    const out = stripSGR(
      renderToString(
        createElement(Table<{ name: string }>, { columns: longCols, rows: longRows }),
        opts,
      ),
    );
    const dataRow = out.split('\n')[2]!;
    // Truncate to 4 chars + '…' = 5 cells.
    expect(dataRow.startsWith('Bart…')).toBe(true);
  });

  it('renders an empty data section when rows is empty', () => {
    const out = stripSGR(
      renderToString(createElement(Table<Person>, { columns: cols, rows: [] }), opts),
    );
    const lines = out.split('\n');
    expect(lines[0]).toContain('Name');
    expect(lines[1]).toMatch(/^─+/);
    // No data row — line 2 should be blank (or absent in trimmed output).
    expect(lines[2] ?? '').not.toContain('Alice');
  });
});

describe('Table flex columns', () => {
  it('a column without a width fills remaining space', () => {
    const flexCols: TableColumn<Person>[] = [
      { key: 'name', header: 'Name', width: 8 },
      { key: 'age', header: 'Age', width: 4 },
      { key: 'role', header: 'Role' }, // no width — flex
    ];
    const out = stripSGR(
      renderToString(createElement(Table<Person>, { columns: flexCols, rows }), {
        width: 40,
        height: 5,
      }),
    );
    const lines = out.split('\n');
    // Two 1-cell gaps between three columns + 8 + 4 = 14 fixed cells; flex
    // column gets 40 - 14 = 26 cells. Header line padded to total width.
    expect(lines[0]!.length).toBeGreaterThanOrEqual(40);
  });

  it('two flex columns split remaining space', () => {
    const flexCols: TableColumn<Person>[] = [
      { key: 'name', header: 'N' },
      { key: 'age', header: 'A', width: 4 },
      { key: 'role', header: 'R' },
    ];
    const out = stripSGR(
      renderToString(createElement(Table<Person>, { columns: flexCols, rows }), {
        width: 40,
        height: 5,
      }),
    );
    // No assertion on exact widths — just verify no crash + Header characters appear.
    expect(out).toContain('N');
    expect(out).toContain('A');
    expect(out).toContain('R');
  });
});

describe('Table custom rendering', () => {
  it('uses a column.render function when provided', () => {
    const customCols: TableColumn<Person>[] = [
      { key: 'name', header: 'Name', width: 10, render: (val) => `★ ${val as string}` },
      { key: 'age', header: 'Age', width: 4 },
    ];
    const out = stripSGR(
      renderToString(createElement(Table<Person>, { columns: customCols, rows }), opts),
    );
    expect(out).toContain('★ Alice');
  });

  it('column.render receives the full row as a second arg', () => {
    const customCols: TableColumn<Person>[] = [
      {
        key: 'name',
        header: 'Tag',
        width: 18,
        render: (_val, row) => `${row.name}@${row.age}`,
      },
    ];
    const out = stripSGR(
      renderToString(createElement(Table<Person>, { columns: customCols, rows }), opts),
    );
    expect(out).toContain('Alice@30');
    expect(out).toContain('Bob@25');
  });
});

describe('Table missing-value handling', () => {
  it('renders an empty cell when row.key is undefined', () => {
    const sparseRows = [{ name: 'Alice' }] as Person[];
    const out = stripSGR(
      renderToString(createElement(Table<Person>, { columns: cols, rows: sparseRows }), opts),
    );
    const aliceRow = out.split('\n')[2]!;
    // 'Age' column slice should be all spaces (4 cells) since age is undefined.
    expect(aliceRow.slice(9, 13)).toBe('    ');
  });
});
