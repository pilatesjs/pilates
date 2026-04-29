/**
 * gallery — flex-wrap showcase: a grid of cards that flows to new rows
 * when the container can't fit them on one line.
 *
 *   ┌─ Gallery ──────────────────────────────────────────────────┐
 *   │  ╭─ ★ ─╮  ╭─ ✦ ─╮  ╭─ ☀ ─╮  ╭─ ☁ ─╮                       │
 *   │  │ alpha│  │ beta │  │gamma│  │delta│                       │
 *   │  ╰─────╯  ╰──────╯  ╰─────╯  ╰─────╯                       │
 *   │  ╭─ ☂ ─╮  ╭─ ❄ ─╮  ╭─ ⚡ ─╮                                │
 *   │  │epsilo│  │ zeta │  │ eta  │                                │
 *   │  ╰──────╯  ╰──────╯  ╰──────╯                               │
 *   └────────────────────────────────────────────────────────────┘
 *
 * Run with `pnpm --filter @pilates-examples/gallery dev`.
 */

import { type RenderNode, render } from '@pilates/render';

const cols = process.stdout.columns ?? 80;
const rows = process.stdout.rows ?? 24;

const items: Array<{
  name: string;
  symbol: string;
  color: 'red' | 'green' | 'yellow' | 'cyan' | 'magenta' | 'blue';
}> = [
  { name: 'alpha', symbol: '★', color: 'yellow' },
  { name: 'beta', symbol: '✦', color: 'cyan' },
  { name: 'gamma', symbol: '☀', color: 'yellow' },
  { name: 'delta', symbol: '☁', color: 'cyan' },
  { name: 'epsilon', symbol: '☂', color: 'blue' },
  { name: 'zeta', symbol: '❄', color: 'cyan' },
  { name: 'eta', symbol: '⚡', color: 'yellow' },
  { name: 'theta', symbol: '♣', color: 'green' },
  { name: 'iota', symbol: '♦', color: 'red' },
  { name: 'kappa', symbol: '♥', color: 'red' },
  { name: 'lambda', symbol: '♠', color: 'magenta' },
  { name: 'mu', symbol: '⚓', color: 'blue' },
];

const cards: RenderNode[] = items.map((it) => ({
  width: 14,
  height: 4,
  border: 'rounded',
  borderColor: it.color,
  title: it.symbol,
  titleColor: it.color,
  children: [{ text: it.name, color: it.color }],
}));

const tree: RenderNode = {
  width: cols,
  height: rows,
  border: 'single',
  title: 'Gallery',
  flexDirection: 'row',
  flexWrap: 'wrap',
  alignContent: 'flex-start',
  gap: { row: 0, column: 2 },
  padding: { left: 1, right: 1, top: 1, bottom: 1 },
  children: cards,
};

process.stdout.write(render(tree));
process.stdout.write('\n');
