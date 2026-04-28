/**
 * chat-log — a two-pane chat layout with a sidebar status panel.
 *
 *   ╭─ Chat ────────────────────────────────╮┌─ Status ───────────┐
 *   │ [12:00] alice: morning team           ││ connected          │
 *   │ [12:01] bob:   morning ☕             ││ 4 users online     │
 *   │ ...                                   ││                    │
 *   ╰───────────────────────────────────────╯└────────────────────┘
 *
 * Static demo: builds the tree, calls render(), writes the result.
 * Run with `pnpm --filter @tercli-examples/chat-log dev`.
 */

import { type RenderNode, render } from '@tercli/render';

const cols = process.stdout.columns ?? 80;
const rows = process.stdout.rows ?? 24;

interface Message {
  time: string;
  user: string;
  text: string;
  color?: 'red' | 'green' | 'yellow' | 'cyan' | 'magenta';
}

const messages: Message[] = [
  { time: '12:00', user: 'alice', text: 'morning team', color: 'cyan' },
  { time: '12:01', user: 'bob', text: 'morning ☕', color: 'yellow' },
  { time: '12:05', user: 'carol', text: 'starting the migration now', color: 'green' },
  { time: '12:06', user: 'alice', text: 'good luck — paging me if anything looks weird' },
  { time: '12:09', user: 'bob', text: '+1, watching the dashboard' },
  { time: '12:14', user: 'carol', text: 'phase 1 done; moving to phase 2 in a sec' },
  { time: '12:17', user: 'dave', text: '👀 looking at the latency graph' },
  { time: '12:18', user: 'dave', text: 'p99 is fine, p50 dipped briefly then recovered' },
  { time: '12:22', user: 'carol', text: '请求完成 ✅', color: 'green' },
  { time: '12:23', user: 'alice', text: 'nice 🎉' },
];

const status: RenderNode = {
  width: 22,
  border: 'single',
  title: 'Status',
  children: [
    { text: '● connected', color: 'green' },
    { text: '4 users online' },
    { text: '' },
    { text: 'Pending: 0' },
    { text: 'Errors: 0' },
  ],
};

// Each message renders as a single text leaf so it gets natural-height
// sizing from the measure function. (Container intrinsic sizing is out of
// v1 — see core's docs.) Per-message color follows the user.
const chat: RenderNode = {
  flex: 1,
  border: 'rounded',
  title: 'Chat',
  children: messages.map((m) => ({
    text: `[${m.time}] ${m.user}: ${m.text}`,
    color: m.color ?? 'white',
  })),
};

const tree: RenderNode = {
  width: cols,
  height: rows,
  flexDirection: 'row',
  children: [chat, status],
};

process.stdout.write(render(tree));
process.stdout.write('\n');
