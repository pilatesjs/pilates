/**
 * dashboard — system-monitor-style layout showcasing alignment values.
 *
 * Top bar shows status with `justifyContent: 'space-between'`.
 * Stat tiles use `gap` and `alignItems: 'center'`.
 * Bottom strip uses `justifyContent: 'space-around'` for the metrics.
 *
 *   ┌─ Pilates Dashboard ─────────────────────────────────────────┐
 *   │ ● running                              uptime  3d 14h 22m  │
 *   ├─────────────────────────────────────────────────────────────┤
 *   │  ╭─ CPU ─╮  ╭─ Memory ─╮  ╭─ Disk ─╮  ╭─ Network ─╮         │
 *   │  │ 47%   │  │ 8.2 GB   │  │ 124 GB │  │ 12 MB/s   │         │
 *   │  │       │  │ /16 GB   │  │ /500GB │  │ ↓ 8 ↑ 4   │         │
 *   │  ╰───────╯  ╰──────────╯  ╰────────╯  ╰───────────╯         │
 *   ├─────────────────────────────────────────────────────────────┤
 *   │     read 412/s     write 87/s     errors 0     latency 4ms │
 *   └─────────────────────────────────────────────────────────────┘
 *
 * Run with `pnpm --filter @pilates-examples/dashboard dev`.
 */

import { type RenderNode, render } from '@pilates/render';

const cols = process.stdout.columns ?? 80;
const rows = process.stdout.rows ?? 20;

interface Tile {
  title: string;
  value: string;
  detail?: string;
  color: 'green' | 'yellow' | 'red' | 'cyan' | 'magenta';
}

const tiles: Tile[] = [
  { title: 'CPU', value: '47%', detail: 'load 1.4', color: 'green' },
  { title: 'Memory', value: '8.2 GB', detail: '/ 16 GB', color: 'cyan' },
  { title: 'Disk', value: '124 GB', detail: '/ 500 GB', color: 'cyan' },
  { title: 'Network', value: '12 MB/s', detail: '↓ 8  ↑ 4', color: 'magenta' },
];

const tileWidth = Math.floor((cols - 2 - tiles.length * 2 - 2) / tiles.length);

// Container nodes need explicit height — text-leaf intrinsic sizing
// doesn't propagate up to multi-child containers in v1.
const tileNodes: RenderNode[] = tiles.map((t) => ({
  width: tileWidth,
  height: 4,
  border: 'rounded',
  title: t.title,
  children: [
    { text: t.value, color: t.color, bold: true },
    { text: t.detail ?? '', color: 'gray' },
  ],
}));

const header: RenderNode = {
  height: 3,
  border: 'single',
  title: 'Pilates Dashboard',
  flexDirection: 'row',
  justifyContent: 'space-between',
  alignItems: 'center',
  children: [
    { text: '● running', color: 'green', bold: true },
    { text: 'uptime  3d 14h 22m', color: 'gray' },
  ],
};

const tilesRow: RenderNode = {
  flex: 1,
  flexDirection: 'row',
  alignItems: 'flex-start',
  gap: { column: 2 },
  padding: { left: 1, right: 1, top: 1, bottom: 1 },
  children: tileNodes,
};

const metrics: RenderNode = {
  height: 1,
  flexDirection: 'row',
  justifyContent: 'space-around',
  alignItems: 'center',
  children: [
    { text: 'read 412/s', color: 'green' },
    { text: 'write 87/s', color: 'cyan' },
    { text: 'errors 0', color: 'green' },
    { text: 'latency 4ms', color: 'gray' },
  ],
};

const footer: RenderNode = {
  height: 3,
  border: 'single',
  children: [metrics],
};

const tree: RenderNode = {
  width: cols,
  height: rows,
  flexDirection: 'column',
  children: [header, tilesRow, footer],
};

process.stdout.write(render(tree));
process.stdout.write('\n');
