/**
 * split-pane — header + 3-pane body + status footer.
 *
 *   ┌─ tercli ─────────────────────────────────────────────────────────────────┐
 *   │ Headless layout engine for terminal UIs                                  │
 *   └──────────────────────────────────────────────────────────────────────────┘
 *   ┌─ Files ──────────┐╭─ Editor ───────────────────────────────────╮┌─ Outline ─────┐
 *   │ src/             ││ 1  export function render(node) {          ││ render        │
 *   │ ├ index.ts       ││ 2    const bridge = build(node);           ││  ├ build      │
 *   │ ├ render.ts      ││ 3    bridge.root.calculateLayout();        ││  ├ calculate  │
 *   │ ├ build.ts       ││ 4    const frame = new Frame(...);         ││  ├ paint      │
 *   │ └ painter.ts     ││ 5    paint(frame, bridge);                 ││  └ toString   │
 *   │                  ││ 6    return frame.toString();              ││               │
 *   │ test/            ││ 7  }                                       ││               │
 *   │                  ││                                            ││               │
 *   └──────────────────┘╰────────────────────────────────────────────╯└───────────────┘
 *    STATUS: ready    main • TypeScript • LF • UTF-8 • 7:9
 *
 * Run with `pnpm --filter @tercli-examples/split-pane dev`.
 */

import { type RenderNode, render } from '@tercli/render';

const cols = process.stdout.columns ?? 80;
const rows = process.stdout.rows ?? 24;

const files: RenderNode = {
  width: 20,
  border: 'single',
  title: 'Files',
  children: [
    { text: 'src/', color: 'cyan' },
    { text: '├ index.ts' },
    { text: '├ render.ts' },
    { text: '├ build.ts' },
    { text: '└ painter.ts' },
    { text: '' },
    { text: 'test/', color: 'cyan' },
  ],
};

const editor: RenderNode = {
  flex: 1,
  border: 'rounded',
  title: 'Editor',
  children: [
    { text: '1  export function render(node) {', color: 'gray' },
    { text: '2    const bridge = build(node);' },
    { text: '3    bridge.root.calculateLayout();' },
    { text: '4    const frame = new Frame(' },
    { text: '5      bridge.root.layout.width,' },
    { text: '6      bridge.root.layout.height,' },
    { text: '7    );' },
    { text: '8    paint(frame, bridge);' },
    { text: '9    return frame.toString();' },
    { text: '10 }' },
  ],
};

const outline: RenderNode = {
  width: 18,
  border: 'single',
  title: 'Outline',
  children: [
    { text: 'render', bold: true, color: 'yellow' },
    { text: ' ├ build' },
    { text: ' ├ calculate' },
    { text: ' ├ paint' },
    { text: ' └ toString' },
  ],
};

const tree: RenderNode = {
  width: cols,
  height: rows,
  flexDirection: 'column',
  children: [
    {
      height: 3,
      border: 'single',
      title: 'tercli',
      children: [{ text: 'Headless layout engine for terminal UIs', color: 'cyan' }],
    },
    {
      flex: 1,
      flexDirection: 'row',
      children: [files, editor, outline],
    },
    {
      height: 1,
      flexDirection: 'row',
      children: [
        { text: ' STATUS: ready ', bgColor: 'blue', color: 'brightWhite', bold: true },
        { text: '  main', color: 'cyan', flex: 1 },
        { text: 'TypeScript • LF • UTF-8 ', color: 'gray' },
      ],
    },
  ],
};

process.stdout.write(render(tree));
process.stdout.write('\n');
