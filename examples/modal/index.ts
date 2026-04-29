/**
 * modal — absolute-positioning showcase: a centered "confirm" modal
 * floating above a background pane.
 *
 *   ┌─ App ─────────────────────────────────────────────────────────┐
 *   │ users:                                                        │
 *   │  ├ alice                                                      │
 *   │  ├ bob       ┌─ Confirm action ────────────────┐              │
 *   │  ├ carol     │                                 │              │
 *   │  ├ dave      │  Delete user "carol"?           │              │
 *   │  ├ eve       │                                 │              │
 *   │  ├ frank     │       [ cancel ]   [ delete ]   │              │
 *   │  ├ grace     │                                 │              │
 *   │  ├ henry     └─────────────────────────────────┘              │
 *   │  ├ ivy                                                        │
 *   │  └ jack                                                       │
 *   └───────────────────────────────────────────────────────────────┘
 *
 * Run with `pnpm --filter @pilates-examples/modal dev`.
 */

import { type RenderNode, render } from '@pilates/render';

const cols = process.stdout.columns ?? 80;
const rows = process.stdout.rows ?? 20;

const users = ['alice', 'bob', 'carol', 'dave', 'eve', 'frank', 'grace', 'henry', 'ivy', 'jack'];

// Center the modal inside the container by computing its top/left from
// the parent's outer dimensions. (Yoga semantics: absolute offsets are
// relative to the parent's outer box, so we don't subtract padding.)
const modalWidth = 36;
const modalHeight = 7;
const modalLeft = Math.floor((cols - modalWidth) / 2);
const modalTop = Math.floor((rows - modalHeight) / 2);

const background: RenderNode = {
  flex: 1,
  border: 'single',
  title: 'App',
  children: [
    { text: 'users:', color: 'cyan', bold: true },
    ...users.map((u) => ({ text: ` ├ ${u}` })),
  ],
};

const modal: RenderNode = {
  positionType: 'absolute',
  position: { top: modalTop, left: modalLeft },
  width: modalWidth,
  height: modalHeight,
  border: 'rounded',
  borderColor: 'yellow',
  title: 'Confirm action',
  titleColor: 'yellow',
  flexDirection: 'column',
  justifyContent: 'space-between',
  padding: { top: 1, bottom: 1, left: 2, right: 2 },
  children: [
    { text: 'Delete user "carol"?', bold: true },
    {
      flexDirection: 'row',
      justifyContent: 'space-around',
      height: 1,
      children: [
        { text: '[ cancel ]', color: 'gray' },
        { text: '[ delete ]', color: 'red', bold: true },
      ],
    },
  ],
};

const tree: RenderNode = {
  width: cols,
  height: rows,
  flexDirection: 'column',
  children: [background, modal],
};

process.stdout.write(render(tree));
process.stdout.write('\n');
