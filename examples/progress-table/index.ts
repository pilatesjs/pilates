/**
 * progress-table — a dashboard of tasks with progress bars and status colors.
 *
 *   ╭─ Tasks ─────────────────────────────────────────────────────╮
 *   │ Build           ████████████████████  100%  done            │
 *   │ Test            ███████████████░░░░░   75%  running         │
 *   │ Deploy          ░░░░░░░░░░░░░░░░░░░░    0%  pending         │
 *   ╰─────────────────────────────────────────────────────────────╯
 *
 * Run with `pnpm --filter @pilates-examples/progress-table dev`.
 */

import { type RenderNode, render } from '@pilates/render';
import type { Color } from '@pilates/render';

const cols = process.stdout.columns ?? 80;

interface Task {
  name: string;
  pct: number;
  status: 'done' | 'running' | 'pending' | 'failed';
}

const tasks: Task[] = [
  { name: 'lint', pct: 100, status: 'done' },
  { name: 'typecheck', pct: 100, status: 'done' },
  { name: 'unit tests', pct: 100, status: 'done' },
  { name: 'integration tests', pct: 75, status: 'running' },
  { name: 'package', pct: 0, status: 'pending' },
  { name: 'deploy:staging', pct: 0, status: 'pending' },
  { name: 'deploy:prod', pct: 0, status: 'pending' },
  { name: 'old job', pct: 32, status: 'failed' },
];

const STATUS_COLOR: Record<Task['status'], Color> = {
  done: 'green',
  running: 'yellow',
  pending: 'gray',
  failed: 'red',
};

function progressBar(pct: number, width: number): string {
  const clamped = Math.max(0, Math.min(100, pct));
  const filled = Math.round((clamped / 100) * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

const BAR_WIDTH = 20;

const tree: RenderNode = {
  width: cols,
  height: tasks.length + 2, // +2 for top/bottom border
  border: 'rounded',
  title: 'Tasks',
  children: tasks.map((t) => ({
    flexDirection: 'row',
    height: 1,
    gap: { column: 2 },
    children: [
      { text: t.name, width: 22 },
      { text: progressBar(t.pct, BAR_WIDTH), color: STATUS_COLOR[t.status] },
      { text: `${String(t.pct).padStart(3)}%`, width: 4 },
      { text: t.status, color: STATUS_COLOR[t.status], flex: 1 },
    ],
  })),
};

process.stdout.write(render(tree));
process.stdout.write('\n');
