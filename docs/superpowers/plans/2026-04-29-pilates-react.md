# `@pilates/react` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a React reconciler for Pilates so users author terminal UIs with JSX and hooks, with the same engine guarantees (cell-correct layout, incremental redraw via `@pilates/diff`) as the imperative `@pilates/render` API. Ship as `@pilates/react@0.1.0-rc.1` with `next` dist-tag.

**Architecture:** Approach A from the design — host instances are POJOs matching `RenderNode` shape from `@pilates/render`. The reconciler mutates the POJO tree directly; on each `resetAfterCommit` we run `renderToFrame → diff → applyDiff → stdout.write`. No new node types, no inheritance hierarchy — the React tree IS the input the renderer was already designed to take.

**Tech Stack:** TypeScript (strict, ESM), React 19+, react-reconciler 0.31, vitest, pnpm workspaces, biome. Engine deps: `@pilates/core`, `@pilates/render`, `@pilates/diff` (workspace).

**Source spec:** `docs/superpowers/specs/2026-04-29-pilates-react-design.md`

---

## File Structure

**Created in `packages/react/`:**
- `package.json` — peer/runtime deps, exports field, sideEffects:false
- `tsconfig.json` — extends base, jsx: "react-jsx", composite refs to core/render/diff
- `README.md` — package-level docs
- `src/index.ts` — public barrel
- `src/components.tsx` — Box, Text, Spacer, Newline (JSX → host-tag mapping via React.createElement)
- `src/host-config.ts` — react-reconciler HostConfig implementation
- `src/reconciler.ts` — createReconciler() factory + container/instance types
- `src/render.tsx` — public render() entry: SIGWINCH wiring, diff loop, lifecycle
- `src/hooks.ts` — useApp, useStdout, useStderr + AppContext
- `src/test-utils.ts` — renderToString test helper (NOT in public exports)
- `src/render.test.tsx` — integration tests
- `src/text-flatten.ts` — flatten <Text> children into a string + validation
- `src/text-flatten.test.ts` — unit tests for flatten + validation

**Created in `examples/`:**
- `examples/react-counter/{package.json, index.tsx, README.md}`
- `examples/react-dashboard/{package.json, index.tsx, README.md}`
- `examples/react-modal/{package.json, index.tsx, README.md}`

**Modified:**
- `CHANGELOG.md` — add `@pilates/react@0.1.0-rc.1` entry
- `README.md` (root) — add @pilates/react to install / packages list (small addition, near the existing core/render/diff list)

---

## Task 1: Scaffold the package skeleton

**Files:**
- Create: `packages/react/package.json`
- Create: `packages/react/tsconfig.json`
- Create: `packages/react/README.md`
- Create: `packages/react/src/index.ts`

- [ ] **Step 1: Create `packages/react/package.json`**

```json
{
  "name": "@pilates/react",
  "version": "0.1.0-rc.1",
  "description": "React reconciler for @pilates/core. Author terminal UIs with JSX and hooks.",
  "license": "MIT",
  "author": "Zhijie Wang",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": ["dist", "README.md"],
  "sideEffects": false,
  "scripts": {
    "build": "tsc -b",
    "typecheck": "tsc --noEmit",
    "clean": "rm -rf dist *.tsbuildinfo"
  },
  "dependencies": {
    "@pilates/core": "workspace:*",
    "@pilates/render": "workspace:*",
    "@pilates/diff": "workspace:*",
    "react-reconciler": "^0.31.0"
  },
  "peerDependencies": {
    "react": "^19.0.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-reconciler": "^0.28.9",
    "react": "^19.0.0"
  },
  "repository": {
    "type": "git",
    "url": "git+https://github.com/pilatesjs/pilates.git",
    "directory": "packages/react"
  },
  "homepage": "https://github.com/pilatesjs/pilates#readme",
  "bugs": {
    "url": "https://github.com/pilatesjs/pilates/issues"
  },
  "keywords": ["terminal", "tui", "cli", "react", "reconciler", "ink", "pilates"],
  "engines": {
    "node": ">=20"
  }
}
```

- [ ] **Step 2: Create `packages/react/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "./src",
    "outDir": "./dist",
    "tsBuildInfoFile": "./.tsbuildinfo",
    "composite": true,
    "jsx": "react-jsx"
  },
  "include": ["src/**/*"],
  "exclude": ["src/**/*.test.ts", "src/**/*.test.tsx", "dist", "node_modules"],
  "references": [
    { "path": "../core" },
    { "path": "../render" },
    { "path": "../diff" }
  ]
}
```

- [ ] **Step 3: Create `packages/react/src/index.ts` (placeholder)**

```ts
export const VERSION = '0.1.0-rc.1';
```

- [ ] **Step 4: Create `packages/react/README.md` (placeholder)**

```markdown
# @pilates/react

React reconciler for [@pilates/core](https://www.npmjs.com/package/@pilates/core). Author terminal UIs with JSX and hooks.

> **Pre-release.** API is stabilising; install with the `next` dist-tag: `npm install @pilates/react@next`.

Full docs to follow.
```

- [ ] **Step 5: Install deps and run a build to verify scaffolding compiles**

Run from repo root: `pnpm install && pnpm --filter @pilates/react build`
Expected: pnpm reports the new package, install succeeds, `tsc -b` produces `packages/react/dist/index.{js,d.ts}` with no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/react/ pnpm-lock.yaml
git commit -m "feat(react): scaffold @pilates/react package skeleton"
```

---

## Task 2: Set up the test harness — `renderToString`

**Files:**
- Create: `packages/react/src/test-utils.ts`
- Create: `packages/react/src/render.test.tsx`

- [ ] **Step 1: Write the failing test**

`packages/react/src/render.test.tsx`:
```tsx
import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToString } from './test-utils.js';

describe('renderToString', () => {
  it('returns empty string when given an empty React element', () => {
    const out = renderToString(<></>, { width: 4, height: 1 });
    // Empty fragment paints a 4x1 frame of spaces; toPlainString gives
    // 4 spaces + a trailing \n separator (Frame.toString convention).
    expect(out.replace(/\x1b\[[0-9;]*m/g, '')).toBe('    \n');
  });
});
```

- [ ] **Step 2: Create `packages/react/src/test-utils.ts` (will compile but the test will fail at runtime)**

```ts
import type { ReactElement } from 'react';

export interface RenderToStringOptions {
  width: number;
  height: number;
}

/**
 * Mount a React element with a fake stdout, run one commit, and return
 * the concatenated string of all writes. Test-only — NOT in the public
 * package barrel.
 */
export function renderToString(_element: ReactElement, _options: RenderToStringOptions): string {
  throw new Error('renderToString not implemented');
}
```

- [ ] **Step 3: Run the test and confirm it fails**

Run: `pnpm vitest run packages/react/src/render.test.tsx`
Expected: FAIL with "renderToString not implemented".

- [ ] **Step 4: Commit (red state — failing test, stub helper)**

```bash
git add packages/react/src/test-utils.ts packages/react/src/render.test.tsx
git commit -m "test(react): add renderToString harness stub and first failing test"
```

---

## Task 3: Reconciler types and container

**Files:**
- Create: `packages/react/src/reconciler.ts`

- [ ] **Step 1: Define the host instance types**

`packages/react/src/reconciler.ts`:
```ts
import type { ContainerNode, Frame, TextNode } from '@pilates/render';

/**
 * A host instance tracked by react-reconciler. Mirrors the RenderNode
 * tagged union shape directly — `kind` discriminates so HostConfig
 * methods can route without instanceof checks.
 *
 * <Text>'s `fragments` array holds direct references to TextFragment /
 * TextInstance children (NOT raw strings) so commitTextUpdate can mutate
 * a fragment's text and have flattenText see the new value via the
 * parent back-pointer.
 */
export interface BoxInstance {
  kind: 'box';
  node: ContainerNode;
}

export interface TextInstance {
  kind: 'text';
  node: TextNode;
  /** Direct references to children. Re-flattened on every commitUpdate / commitTextUpdate. */
  fragments: Array<TextFragment | TextInstance>;
}

/** A string leaf returned by createTextInstance. Carries a back-pointer to its parent <Text>. */
export interface TextFragment {
  kind: 'fragment';
  text: string;
  parent: TextInstance | null;
}

export type HostInstance = BoxInstance | TextInstance;
export type AnyInstance = HostInstance | TextFragment;

/** Root container that owns the top-level RenderNode tree. */
export interface RootContainer {
  root: ContainerNode;
  /** The most recent rendered Frame; null before the first commit. */
  prevFrame: Frame | null;
  /** Called after each commit with the (possibly empty) ANSI delta string. */
  onFlush: (ansi: string) => void;
}
```

- [ ] **Step 2: Run typecheck to verify types compile**

Run: `pnpm --filter @pilates/react typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/react/src/reconciler.ts
git commit -m "feat(react): define HostInstance and RootContainer types"
```

---

## Task 4: Text flatten helper + validation

**Files:**
- Create: `packages/react/src/text-flatten.ts`
- Create: `packages/react/src/text-flatten.test.ts`

- [ ] **Step 1: Write failing tests**

`packages/react/src/text-flatten.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import type { TextFragment, TextInstance } from './reconciler.js';
import { flattenText } from './text-flatten.js';

function frag(text: string): TextFragment {
  return { kind: 'fragment', text, parent: null };
}
function textInst(fragments: TextInstance['fragments']): TextInstance {
  return { kind: 'text', node: { text: '' }, fragments };
}

describe('flattenText', () => {
  it('concatenates string fragments', () => {
    expect(flattenText(textInst([frag('hello'), frag(' '), frag('world')]))).toBe('hello world');
  });

  it('flattens nested <Text> by concatenating its text', () => {
    const inner = textInst([frag('inner')]);
    expect(flattenText(textInst([frag('outer '), inner]))).toBe('outer inner');
  });

  it('throws if a fragment is something other than TextFragment or TextInstance', () => {
    const bad = { kind: 'box', node: {} } as unknown as TextInstance['fragments'][number];
    expect(() => flattenText(textInst([bad]))).toThrow(
      /Pilates: <Text> children must be string, number, <Text>, or <Newline>/,
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run packages/react/src/text-flatten.test.ts`
Expected: FAIL ("Cannot find module './text-flatten.js'").

- [ ] **Step 3: Implement `flattenText`**

`packages/react/src/text-flatten.ts`:
```ts
import type { TextInstance } from './reconciler.js';

/**
 * Flatten a <Text> instance's children into a single string.
 *
 * Children are TextFragment refs (one per string/number child or
 * <Newline>) and nested TextInstance refs. Nested style props are
 * intentionally lost in v0.1 (only the text content propagates) — see
 * spec.
 *
 * Throws on any other value (e.g. a <Box> placed inside <Text>).
 */
export function flattenText(instance: TextInstance): string {
  let out = '';
  for (const f of instance.fragments) {
    const k = (f as { kind?: string } | null)?.kind;
    if (k === 'fragment') {
      out += (f as { text: string }).text;
    } else if (k === 'text') {
      out += flattenText(f as TextInstance);
    } else {
      const display = k ?? typeof f;
      throw new Error(
        `Pilates: <Text> children must be string, number, <Text>, or <Newline>. Got: ${display}`,
      );
    }
  }
  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run packages/react/src/text-flatten.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/text-flatten.ts packages/react/src/text-flatten.test.ts
git commit -m "feat(react): add flattenText helper with validation"
```

---

## Task 5: HostConfig — createInstance / createTextInstance / appendInitialChild

**Files:**
- Create: `packages/react/src/host-config.ts`

- [ ] **Step 1: Write the HostConfig skeleton**

`packages/react/src/host-config.ts`:
```ts
import type { HostConfig } from 'react-reconciler';
import type { RenderNode } from '@pilates/render';
import type { AnyInstance, BoxInstance, HostInstance, RootContainer, TextFragment, TextInstance } from './reconciler.js';
import { flattenText } from './text-flatten.js';

/** Strip undefined values from an object so JSX `prop={undefined}` doesn't override real defaults. */
function defined<T extends object>(props: T): Partial<T> {
  const out: Partial<T> = {};
  for (const k in props) {
    const v = props[k];
    if (v !== undefined) out[k] = v;
  }
  return out;
}

export function buildHostConfig(): HostConfig<
  /* Type */ string,
  /* Props */ Record<string, unknown>,
  /* Container */ RootContainer,
  /* Instance */ HostInstance,
  /* TextInstance */ TextFragment,
  /* SuspenseInstance */ never,
  /* HydratableInstance */ never,
  /* PublicInstance */ HostInstance,
  /* HostContext */ object,
  /* UpdatePayload */ Record<string, unknown>,
  /* ChildSet */ never,
  /* TimeoutHandle */ ReturnType<typeof setTimeout>,
  /* NoTimeout */ -1
> {
  // Filled in across subsequent tasks. For now, throw on every method
  // so a consumer trying to mount gets a clear error.
  const TODO = (name: string) => () => {
    throw new Error(`HostConfig.${name} not implemented`);
  };
  return {
    supportsMutation: true,
    supportsPersistence: false,
    supportsHydration: false,
    isPrimaryRenderer: true,
    noTimeout: -1,
    scheduleTimeout: setTimeout,
    cancelTimeout: clearTimeout,
    getRootHostContext: () => ({}),
    getChildHostContext: (parent) => parent,
    getPublicInstance: (instance) => instance,
    prepareForCommit: () => null,
    resetAfterCommit: TODO('resetAfterCommit'),
    preparePortalMount: () => {},
    shouldSetTextContent: () => false,
    createInstance: (type, props) => createInstance(type, props),
    createTextInstance: (text) => ({ kind: 'fragment', text, parent: null }),
    appendInitialChild: (parent, child) => appendChildImpl(parent, child),
    finalizeInitialChildren: TODO('finalizeInitialChildren') as never,
    appendChild: (parent, child) => appendChildImpl(parent, child),
    appendChildToContainer: (container, child) => appendChildToContainer(container, child),
    insertBefore: TODO('insertBefore') as never,
    insertInContainerBefore: TODO('insertInContainerBefore') as never,
    removeChild: TODO('removeChild') as never,
    removeChildFromContainer: TODO('removeChildFromContainer') as never,
    prepareUpdate: TODO('prepareUpdate') as never,
    commitUpdate: TODO('commitUpdate') as never,
    commitTextUpdate: TODO('commitTextUpdate') as never,
    clearContainer: (container) => {
      container.root.children = [];
    },
    detachDeletedInstance: () => {},
  };
}

function createInstance(type: string, props: Record<string, unknown>): HostInstance {
  const cleaned = defined(props);
  if (type === 'pilates-box') {
    const { children: _ignored, ...rest } = cleaned;
    return { kind: 'box', node: { ...rest, children: [] } as RenderNode } as BoxInstance;
  }
  if (type === 'pilates-text') {
    const { children: _ignored, ...rest } = cleaned;
    return {
      kind: 'text',
      node: { ...rest, text: '' } as RenderNode,
      fragments: [],
    } as TextInstance;
  }
  throw new Error(`Pilates: unknown host type "${type}"`);
}

function appendChildImpl(parent: HostInstance, child: AnyInstance): void {
  if (parent.kind === 'text') {
    if (child.kind === 'fragment') {
      child.parent = parent;
      parent.fragments.push(child);
      return;
    }
    if (child.kind === 'text') {
      parent.fragments.push(child);
      return;
    }
    throw new Error(
      `Pilates: <Text> children must be string, number, <Text>, or <Newline>. Got: ${(child as { kind?: string }).kind}`,
    );
  }
  // Box parent
  if (child.kind === 'fragment') {
    throw new Error('Pilates: bare strings are not allowed as <Box> children. Wrap them in <Text>.');
  }
  parent.node.children = parent.node.children ?? [];
  (parent.node.children as RenderNode[]).push(child.node);
}

function appendChildToContainer(container: RootContainer, child: AnyInstance): void {
  if (child.kind === 'fragment') {
    throw new Error('Pilates: bare strings are not allowed at the root. Wrap them in <Text>.');
  }
  container.root.children = container.root.children ?? [];
  (container.root.children as RenderNode[]).push(child.node);
}
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm --filter @pilates/react typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/react/src/host-config.ts
git commit -m "feat(react): HostConfig skeleton with createInstance + appendChild"
```

---

## Task 6: HostConfig — finalizeInitialChildren (text flatten on mount)

**Files:**
- Modify: `packages/react/src/host-config.ts`

- [ ] **Step 1: Add `finalizeInitialChildren` and the supporting flatten-and-write helper**

Replace the `finalizeInitialChildren: TODO('finalizeInitialChildren') as never,` line in `buildHostConfig()` with:

```ts
    finalizeInitialChildren: (instance) => {
      finalizeText(instance);
      return false; // don't request commitMount
    },
```

Add this function below `appendChildToContainer`:

```ts
function finalizeText(instance: HostInstance): void {
  if (instance.kind !== 'text') return;
  instance.node.text = flattenText(instance);
}
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm --filter @pilates/react typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/react/src/host-config.ts
git commit -m "feat(react): finalizeInitialChildren flattens <Text> children"
```

---

## Task 7: HostConfig — tree mutation (insertBefore, removeChild)

**Files:**
- Modify: `packages/react/src/host-config.ts`

- [ ] **Step 1: Replace the TODO mutation methods**

In `buildHostConfig()`, replace the `insertBefore`/`insertInContainerBefore`/`removeChild`/`removeChildFromContainer` lines with:

```ts
    insertBefore: (parent, child, before) => insertBeforeImpl(parent, child, before),
    insertInContainerBefore: (container, child, before) => insertBeforeContainerImpl(container, child, before),
    removeChild: (parent, child) => removeChildImpl(parent, child),
    removeChildFromContainer: (container, child) => removeChildFromContainerImpl(container, child),
```

Add these helpers at the bottom of the file:

```ts
function insertBeforeImpl(parent: HostInstance, child: AnyInstance, before: AnyInstance): void {
  if (parent.kind === 'text') {
    if (child.kind === 'fragment' || child.kind === 'text') {
      if (child.kind === 'fragment') child.parent = parent;
      const beforeIdx = parent.fragments.indexOf(before as TextFragment | TextInstance);
      if (beforeIdx === -1) parent.fragments.push(child);
      else parent.fragments.splice(beforeIdx, 0, child);
      parent.node.text = flattenText(parent);
      return;
    }
    throw new Error(
      `Pilates: <Text> children must be string, number, <Text>, or <Newline>. Got: ${(child as { kind?: string }).kind}`,
    );
  }
  if (child.kind === 'fragment') {
    throw new Error('Pilates: bare strings are not allowed as <Box> children. Wrap them in <Text>.');
  }
  if (before.kind === 'fragment') {
    throw new Error('Pilates: invariant — Box children should never be string fragments.');
  }
  const arr = (parent.node.children ??= []) as RenderNode[];
  const idx = arr.indexOf(before.node);
  if (idx === -1) arr.push(child.node);
  else arr.splice(idx, 0, child.node);
}

function insertBeforeContainerImpl(container: RootContainer, child: AnyInstance, before: AnyInstance): void {
  if (child.kind === 'fragment') {
    throw new Error('Pilates: bare strings are not allowed at the root. Wrap them in <Text>.');
  }
  if (before.kind === 'fragment') {
    throw new Error('Pilates: invariant — root children should never be string fragments.');
  }
  const arr = (container.root.children ??= []) as RenderNode[];
  const idx = arr.indexOf(before.node);
  if (idx === -1) arr.push(child.node);
  else arr.splice(idx, 0, child.node);
}

function removeChildImpl(parent: HostInstance, child: AnyInstance): void {
  if (parent.kind === 'text') {
    if (child.kind === 'fragment' || child.kind === 'text') {
      parent.fragments = parent.fragments.filter((f) => f !== child);
      parent.node.text = flattenText(parent);
    }
    return;
  }
  if (child.kind === 'fragment') return;
  const arr = (parent.node.children ?? []) as RenderNode[];
  const idx = arr.indexOf(child.node);
  if (idx >= 0) arr.splice(idx, 1);
}

function removeChildFromContainerImpl(container: RootContainer, child: AnyInstance): void {
  if (child.kind === 'fragment') return;
  const arr = (container.root.children ?? []) as RenderNode[];
  const idx = arr.indexOf(child.node);
  if (idx >= 0) arr.splice(idx, 1);
}
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm --filter @pilates/react typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/react/src/host-config.ts
git commit -m "feat(react): HostConfig tree mutation (insertBefore, removeChild)"
```

---

## Task 8: HostConfig — commitUpdate / commitTextUpdate / prepareUpdate

**Files:**
- Modify: `packages/react/src/host-config.ts`

- [ ] **Step 1: Replace the TODO update methods**

In `buildHostConfig()`, replace the `prepareUpdate`/`commitUpdate`/`commitTextUpdate` lines with:

```ts
    prepareUpdate: (_instance, _type, oldProps, newProps) => {
      // Always return a payload — react-reconciler skips commitUpdate
      // when this is null. Cheap shallow-compare keeps tests honest.
      let changed = false;
      const out: Record<string, unknown> = {};
      const keys = new Set([...Object.keys(oldProps), ...Object.keys(newProps)]);
      for (const k of keys) {
        if (k === 'children') continue;
        if (oldProps[k] !== newProps[k]) {
          out[k] = newProps[k];
          changed = true;
        }
      }
      return changed ? out : null;
    },
    commitUpdate: (instance, _payload, _type, _oldProps, newProps) => {
      // Mutate `instance.node` IN PLACE — the parent's children array
      // holds a reference to this exact object, so reassigning
      // instance.node would orphan the new value.
      const cleaned = defined(newProps);
      const { children: _ignored, ...rest } = cleaned;
      const target = instance.node as Record<string, unknown>;
      const preserved = instance.kind === 'box' ? 'children' : 'text';
      // Clear all old props except the structural field.
      for (const k of Object.keys(target)) {
        if (k !== preserved) delete target[k];
      }
      // Apply the cleaned new prop set.
      for (const k of Object.keys(rest)) {
        target[k] = rest[k];
      }
    },
    commitTextUpdate: (instance, _oldText, newText) => {
      // `instance` is a TextFragment (from createTextInstance). Mutate
      // the fragment's text and re-flatten its parent <Text> so the
      // RenderNode's node.text reflects the new content. The parent
      // back-pointer was set in appendChildImpl / insertBeforeImpl.
      instance.text = newText;
      if (instance.parent) instance.parent.node.text = flattenText(instance.parent);
    },
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm --filter @pilates/react typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/react/src/host-config.ts
git commit -m "feat(react): HostConfig commitUpdate and commitTextUpdate"
```

---

## Task 9: HostConfig — resetAfterCommit (the diff/write loop)

**Files:**
- Modify: `packages/react/src/host-config.ts`

- [ ] **Step 1: Add the diff/render imports at the top of `host-config.ts`**

After the existing `import` lines:

```ts
import { renderToFrame } from '@pilates/render';
import { applyDiff, diff } from '@pilates/diff';
```

- [ ] **Step 2: Implement `resetAfterCommit`**

In `buildHostConfig()`, replace `resetAfterCommit: TODO('resetAfterCommit'),` with:

```ts
    resetAfterCommit: (container) => {
      const next = renderToFrame(container.root);
      const changes = diff(container.prevFrame, next);
      const ansi = applyDiff(changes);
      container.prevFrame = next;
      if (ansi.length > 0) container.onFlush(ansi);
    },
```

The HostConfig types and `commitTextUpdate` from earlier tasks already keep `node.text` in sync with the latest fragment content (via the parent back-pointer + `flattenText`), so `resetAfterCommit` only needs to render-and-flush.

- [ ] **Step 3: Run typecheck**

Run: `pnpm --filter @pilates/react typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/react/src/host-config.ts
git commit -m "feat(react): resetAfterCommit drives the renderToFrame → diff → write loop"
```

---

## Task 10: Components — Box, Text, Spacer, Newline

**Files:**
- Create: `packages/react/src/components.tsx`

- [ ] **Step 1: Implement components**

`packages/react/src/components.tsx`:
```tsx
import { createElement, type ReactNode } from 'react';
import type { BorderProps, Color, EdgeValue, LayoutProps, TextStyle, Wrap } from '@pilates/render';

/* eslint-disable @typescript-eslint/no-namespace */
declare global {
  namespace JSX {
    interface IntrinsicElements {
      'pilates-box': BoxProps & { children?: ReactNode };
      'pilates-text': TextProps & { children?: ReactNode };
    }
  }
}

export type BoxProps = LayoutProps &
  BorderProps & {
    children?: ReactNode;
  };

export type TextProps = TextStyle & {
  wrap?: Wrap;
  children?: ReactNode;
};

export function Box(props: BoxProps): JSX.Element {
  return createElement('pilates-box', props);
}

export function Text(props: TextProps): JSX.Element {
  return createElement('pilates-text', props);
}

export function Spacer(): JSX.Element {
  return createElement('pilates-box', { flexGrow: 1 });
}

export function Newline(): string {
  return '\n';
}
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm --filter @pilates/react typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/react/src/components.tsx
git commit -m "feat(react): Box, Text, Spacer, Newline components"
```

---

## Task 11: Implement renderToString test harness

**Files:**
- Modify: `packages/react/src/test-utils.ts`

- [ ] **Step 1: Implement `renderToString`**

```ts
import { type ReactElement } from 'react';
import ReactReconciler from 'react-reconciler';
import { LegacyRoot } from 'react-reconciler/constants.js';
import type { ContainerNode } from '@pilates/render';
import { buildHostConfig } from './host-config.js';
import type { RootContainer } from './reconciler.js';

export interface RenderToStringOptions {
  width: number;
  height: number;
}

/**
 * Mount a React element with a fake stdout, run one (synchronous, legacy
 * root) commit, and return the concatenated string of all writes.
 *
 * LegacyRoot is used so that updateContainer flushes synchronously —
 * matching production render() (concurrent mode is a v2 deferral per
 * the design spec).
 *
 * Test-only — NOT in the public package barrel.
 */
export function renderToString(element: ReactElement, options: RenderToStringOptions): string {
  const buf: string[] = [];
  const rootNode: ContainerNode = {
    width: options.width,
    height: options.height,
    children: [],
  };
  const container: RootContainer = {
    root: rootNode,
    prevFrame: null,
    onFlush: (ansi) => buf.push(ansi),
  };
  const reconciler = ReactReconciler(buildHostConfig());
  const containerHandle = reconciler.createContainer(
    container,
    LegacyRoot,
    null,
    false,
    null,
    'pilates',
    () => {},
    null,
  );
  reconciler.updateContainer(element, containerHandle, null, () => {});
  return buf.join('');
}
```

- [ ] **Step 2: Run the first integration test (the empty-fragment test from Task 2)**

Run: `pnpm vitest run packages/react/src/render.test.tsx`
Expected: the empty-fragment test PASSES (the rendered frame is 4 spaces + newline; ANSI strip leaves `'    \n'`).

- [ ] **Step 3: Commit**

```bash
git add packages/react/src/test-utils.ts
git commit -m "feat(react): implement renderToString test harness"
```

---

## Task 12: Static-tree integration tests

**Files:**
- Modify: `packages/react/src/render.test.tsx`

- [ ] **Step 1: Add tests for static trees**

Append to `render.test.tsx`:

```tsx
import { Box, Newline, Spacer, Text } from './components.js';

const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '').replace(/\x1b\[[0-9;]*[Hf]/g, '');

describe('static rendering', () => {
  it('renders a single Text into the frame', () => {
    const out = stripAnsi(renderToString(<Text>hello</Text>, { width: 5, height: 1 }));
    expect(out).toBe('hello\n');
  });

  it('renders a Box with a Text child', () => {
    const out = stripAnsi(
      renderToString(
        <Box width={7} height={1}>
          <Text>hi</Text>
        </Box>,
        { width: 7, height: 1 },
      ),
    );
    expect(out).toBe('hi     \n');
  });

  it('matches the imperative API output cell-for-cell', () => {
    const fromReact = stripAnsi(
      renderToString(
        <Box width={10} height={2} flexDirection="row">
          <Text>a</Text>
          <Text>b</Text>
        </Box>,
        { width: 10, height: 2 },
      ),
    );
    // Equivalent imperative tree
    const { render: imperative } = await import('@pilates/render');
    const fromImperative = imperative(
      {
        width: 10,
        height: 2,
        flexDirection: 'row',
        children: [{ text: 'a' }, { text: 'b' }],
      },
      { ansi: false },
    );
    expect(fromReact.trim()).toBe(fromImperative.trim());
  });

  it('Spacer expands to fill row gap', () => {
    const out = stripAnsi(
      renderToString(
        <Box width={10} height={1} flexDirection="row">
          <Text>a</Text>
          <Spacer />
          <Text>b</Text>
        </Box>,
        { width: 10, height: 1 },
      ),
    );
    expect(out).toBe('a        b\n');
  });

  it('Newline injects \\n into Text', () => {
    const out = stripAnsi(
      renderToString(
        <Text>
          line1
          {'\n'}
          line2
        </Text>,
        { width: 6, height: 2 },
      ),
    );
    expect(out).toBe('line1 \nline2 \n');
  });
});
```

The third test uses an `await import` inside an `it` callback — wrap that test in `async`. Update the test signature: `it('matches the imperative API output cell-for-cell', async () => { ... });`.

- [ ] **Step 2: Run the tests**

Run: `pnpm vitest run packages/react/src/render.test.tsx`
Expected: all tests in this file PASS (6 tests including the empty-fragment one from Task 2).

- [ ] **Step 3: Commit**

```bash
git add packages/react/src/render.test.tsx
git commit -m "test(react): static-tree rendering matches imperative API"
```

---

## Task 13: Re-render diff tests

**Files:**
- Modify: `packages/react/src/test-utils.ts`
- Modify: `packages/react/src/render.test.tsx`

- [ ] **Step 1: Add a `mount` helper that returns a setState-able handle**

In `test-utils.ts` add (alongside `renderToString`):

```ts
import { useState } from 'react';

export interface MountHandle<T> {
  /** Latest captured ANSI write (the most recent flush). */
  lastWrite(): string;
  /** All ANSI writes concatenated, in order. */
  allWrites(): string;
  setState(value: T): void;
  unmount(): void;
}

interface InternalSetter<T> {
  (next: T): void;
}

export function mount<T>(
  initial: T,
  renderFn: (state: T) => ReactElement,
  options: RenderToStringOptions,
): MountHandle<T> {
  let setter: InternalSetter<T> | null = null;
  const writes: string[] = [];

  function Wrapper(props: { initial: T }) {
    const [state, setState] = useState(props.initial);
    setter = setState;
    return renderFn(state);
  }

  const rootNode: ContainerNode = {
    width: options.width,
    height: options.height,
    children: [],
  };
  const container: RootContainer = {
    root: rootNode,
    prevFrame: null,
    onFlush: (ansi) => writes.push(ansi),
  };
  const reconciler = ReactReconciler(buildHostConfig());
  // LegacyRoot flushes setState commits synchronously, which keeps
  // tests deterministic (no need to wrap in act() or flushSync). The
  // production render() also uses LegacyRoot in v0.1 — concurrent mode
  // is a v2 deferral per spec.
  const handle = reconciler.createContainer(container, LegacyRoot, null, false, null, 'pilates', () => {}, null);
  reconciler.updateContainer(createElement(Wrapper, { initial }), handle, null, () => {});

  return {
    lastWrite: () => writes[writes.length - 1] ?? '',
    allWrites: () => writes.join(''),
    setState: (value) => {
      if (!setter) throw new Error('setter not captured');
      setter(value);
      // LegacyRoot flushes synchronously; no extra drain needed.
    },
    unmount: () => {
      reconciler.updateContainer(null, handle, null, () => {});
    },
  };
}
```

`mount()` requires `useState`, `createElement`, and the existing imports. Add to the top of `test-utils.ts`:

```ts
import { createElement, useState, type ReactElement } from 'react';
```

(Replace the existing `import { type ReactElement } from 'react';` line with the above.)

- [ ] **Step 2: Add re-render tests**

Append to `render.test.tsx`:

```tsx
import { mount } from './test-utils.js';

describe('re-render diff', () => {
  it('re-render after setState emits only changed cells', () => {
    const handle = mount(
      0,
      (n) => (
        <Box width={5} height={1}>
          <Text>n={String(n)}</Text>
        </Box>
      ),
      { width: 5, height: 1 },
    );
    const initial = handle.allWrites();
    expect(initial).toContain('n=0');

    handle.setState(7);

    const last = handle.lastWrite();
    // last write must include the changed character '7' but not the
    // unchanged 'n=' prefix (which would imply a full repaint).
    expect(last).toContain('7');
    // SGR resets and cursor positions are allowed; the substring 'n='
    // would appear only if the diff was a full repaint.
    expect(last).not.toContain('n=');
  });

  it('re-render with no changes emits zero ANSI writes', () => {
    const handle = mount(
      'static',
      () => (
        <Box width={6} height={1}>
          <Text>same</Text>
        </Box>
      ),
      { width: 6, height: 1 },
    );
    const writeCountBefore = handle.allWrites().length;
    handle.setState('static-but-key-unused-by-render');
    const writeCountAfter = handle.allWrites().length;
    expect(writeCountAfter).toBe(writeCountBefore);
  });
});
```

- [ ] **Step 3: Run tests**

Run: `pnpm vitest run packages/react/src/render.test.tsx`
Expected: all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/react/src/test-utils.ts packages/react/src/render.test.tsx
git commit -m "test(react): re-render emits incremental cell diffs only"
```

---

## Task 14: Conditional rendering tests

**Files:**
- Modify: `packages/react/src/render.test.tsx`

- [ ] **Step 1: Add tests**

Append to `render.test.tsx`:

```tsx
describe('conditional rendering', () => {
  it('mounts and unmounts branches cleanly', () => {
    const handle = mount(
      true,
      (visible) => (
        <Box width={6} height={1}>
          {visible && <Text>shown</Text>}
        </Box>
      ),
      { width: 6, height: 1 },
    );
    expect(stripAnsi(handle.allWrites())).toContain('shown');

    handle.setState(false);
    // After unmount the visible region should be cleared (rendered as
    // spaces in the new frame). The cumulative writes will include the
    // initial 'shown' + the cleanup.
    const all = stripAnsi(handle.allWrites());
    // The unmount delta should write spaces over 'shown' — five spaces.
    // Since allWrites() concatenates, look for the pattern of the most
    // recent writes ending in spaces. Rough heuristic: the LATEST write
    // should not contain 'shown' but should contain spaces.
    expect(handle.lastWrite()).not.toContain('shown');
  });

  it('switching between two children replaces correctly', () => {
    const handle = mount(
      'a',
      (which) => (
        <Box width={3} height={1}>
          {which === 'a' ? <Text>aaa</Text> : <Text>bbb</Text>}
        </Box>
      ),
      { width: 3, height: 1 },
    );
    expect(stripAnsi(handle.allWrites())).toContain('aaa');
    handle.setState('b');
    expect(stripAnsi(handle.lastWrite())).toContain('bbb');
  });
});
```

- [ ] **Step 2: Run tests**

Run: `pnpm vitest run packages/react/src/render.test.tsx`
Expected: all tests PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/react/src/render.test.tsx
git commit -m "test(react): conditional rendering mounts and unmounts cleanly"
```

---

## Task 15: Composition / fragments / keys tests

**Files:**
- Modify: `packages/react/src/render.test.tsx`

- [ ] **Step 1: Add tests**

```tsx
describe('composition', () => {
  it('Fragment children render as siblings', () => {
    const out = stripAnsi(
      renderToString(
        <Box width={6} height={1} flexDirection="row">
          <>
            <Text>a</Text>
            <Text>b</Text>
            <Text>c</Text>
          </>
        </Box>,
        { width: 6, height: 1 },
      ),
    );
    expect(out).toBe('abc   \n');
  });

  it('arrays with keys render in order', () => {
    const items = ['x', 'y', 'z'];
    const out = stripAnsi(
      renderToString(
        <Box width={6} height={1} flexDirection="row">
          {items.map((s) => (
            <Text key={s}>{s}</Text>
          ))}
        </Box>,
        { width: 6, height: 1 },
      ),
    );
    expect(out).toBe('xyz   \n');
  });

  it('reordering keyed children re-renders correctly', () => {
    const handle = mount<string[]>(
      ['a', 'b', 'c'],
      (items) => (
        <Box width={6} height={1} flexDirection="row">
          {items.map((s) => (
            <Text key={s}>{s}</Text>
          ))}
        </Box>
      ),
      { width: 6, height: 1 },
    );
    expect(stripAnsi(handle.allWrites())).toContain('abc');
    handle.setState(['c', 'b', 'a']);
    expect(stripAnsi(handle.lastWrite())).toContain('cba');
  });

  it('user-defined components compose primitives', () => {
    function Greeting({ name }: { name: string }) {
      return <Text>hi {name}</Text>;
    }
    const out = stripAnsi(
      renderToString(
        <Box width={9} height={1}>
          <Greeting name="ada" />
        </Box>,
        { width: 9, height: 1 },
      ),
    );
    expect(out).toBe('hi ada   \n');
  });
});
```

- [ ] **Step 2: Run tests**

Run: `pnpm vitest run packages/react/src/render.test.tsx`
Expected: all tests PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/react/src/render.test.tsx
git commit -m "test(react): composition, fragments, keyed lists, user components"
```

---

## Task 16: Hooks — AppContext + useApp

**Files:**
- Create: `packages/react/src/hooks.ts`

- [ ] **Step 1: Implement hooks (basic shape — useApp only for now)**

`packages/react/src/hooks.ts`:
```ts
import { createContext, useContext } from 'react';

export interface AppHookValue {
  exit: (error?: Error) => void;
}

export interface StdoutHookValue {
  stdout: NodeJS.WriteStream;
  write: (s: string) => boolean;
  columns: number;
  rows: number;
}

export interface StderrHookValue {
  stderr: NodeJS.WriteStream;
  write: (s: string) => boolean;
}

export const AppContext = createContext<AppHookValue | null>(null);
export const StdoutContext = createContext<StdoutHookValue | null>(null);
export const StderrContext = createContext<StderrHookValue | null>(null);

export function useApp(): AppHookValue {
  const v = useContext(AppContext);
  if (!v) throw new Error('Pilates: useApp() must be used inside <render>.');
  return v;
}

export function useStdout(): StdoutHookValue {
  const v = useContext(StdoutContext);
  if (!v) throw new Error('Pilates: useStdout() must be used inside <render>.');
  return v;
}

export function useStderr(): StderrHookValue {
  const v = useContext(StderrContext);
  if (!v) throw new Error('Pilates: useStderr() must be used inside <render>.');
  return v;
}
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm --filter @pilates/react typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```ts
git add packages/react/src/hooks.ts
git commit -m "feat(react): AppContext + useApp/useStdout/useStderr hooks"
```

---

## Task 17: Public render() entry — minimal version

**Files:**
- Create: `packages/react/src/render.tsx`

- [ ] **Step 1: Implement render()**

`packages/react/src/render.tsx`:
```tsx
import { createElement, type ReactElement } from 'react';
import ReactReconciler from 'react-reconciler';
import { LegacyRoot } from 'react-reconciler/constants.js';
import type { ContainerNode } from '@pilates/render';
import { buildHostConfig } from './host-config.js';
import {
  AppContext,
  type AppHookValue,
  StderrContext,
  type StderrHookValue,
  StdoutContext,
  type StdoutHookValue,
} from './hooks.js';
import type { RootContainer } from './reconciler.js';

export interface RenderOptions {
  width?: number;
  height?: number;
  stdout?: NodeJS.WriteStream;
  stderr?: NodeJS.WriteStream;
}

export interface RenderInstance {
  unmount: () => void;
  waitUntilExit: () => Promise<void>;
}

export function render(element: ReactElement, options: RenderOptions = {}): RenderInstance {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const width = options.width ?? stdout.columns ?? 80;
  const height = options.height ?? stdout.rows ?? 24;

  let unmounted = false;
  let resolveExit!: () => void;
  let rejectExit!: (err: Error) => void;
  const exitPromise = new Promise<void>((res, rej) => {
    resolveExit = res;
    rejectExit = rej;
  });

  const rootNode: ContainerNode = { width, height, children: [] };
  const container: RootContainer = {
    root: rootNode,
    prevFrame: null,
    onFlush: (ansi) => stdout.write(ansi),
  };

  const reconciler = ReactReconciler(buildHostConfig());
  const onUncaughtError = (err: Error) => {
    if (unmounted) return;
    unmounted = true;
    stderr.write(`\x1b[31mPilates render error:\x1b[0m ${err.message}\n${err.stack ?? ''}\n`);
    reconciler.updateContainer(null, handle, null, () => {});
    rejectExit(err);
  };
  const handle = reconciler.createContainer(container, LegacyRoot, null, false, null, 'pilates', onUncaughtError, null);

  const appValue: AppHookValue = {
    exit: (err) => {
      if (err) {
        instance.unmount();
        rejectExit(err);
      } else {
        instance.unmount();
        resolveExit();
      }
    },
  };
  const stdoutValue: StdoutHookValue = {
    stdout,
    write: (s) => stdout.write(s),
    columns: width,
    rows: height,
  };
  const stderrValue: StderrHookValue = {
    stderr,
    write: (s) => stderr.write(s),
  };

  const wrapped = createElement(
    AppContext.Provider,
    { value: appValue },
    createElement(
      StdoutContext.Provider,
      { value: stdoutValue },
      createElement(StderrContext.Provider, { value: stderrValue }, element),
    ),
  );
  reconciler.updateContainer(wrapped, handle, null, () => {});

  const instance: RenderInstance = {
    unmount: () => {
      if (unmounted) return;
      unmounted = true;
      reconciler.updateContainer(null, handle, null, () => {});
      stdout.write('\x1b[0m\n');
      resolveExit();
    },
    waitUntilExit: () => exitPromise,
  };

  return instance;
}
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm --filter @pilates/react typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/react/src/render.tsx
git commit -m "feat(react): public render() entry with context providers and exit promise"
```

---

## Task 18: useApp test — exit() resolves the promise

**Files:**
- Modify: `packages/react/src/render.test.tsx`

- [ ] **Step 1: Write the test**

Append to `render.test.tsx`:

```tsx
import { render } from './render.js';
import { useApp } from './hooks.js';

describe('hooks', () => {
  it('useApp().exit() resolves waitUntilExit', async () => {
    function App() {
      const { exit } = useApp();
      // trigger exit on next microtask so the initial commit completes first
      Promise.resolve().then(() => exit());
      return <Text>hi</Text>;
    }
    const fakeStdout = makeFakeStdout(20, 5);
    const fakeStderr = makeFakeStdout(20, 5);
    const instance = render(<App />, { stdout: fakeStdout, stderr: fakeStderr });
    await instance.waitUntilExit();
    expect(true).toBe(true); // promise resolving is the assertion
  });

  it('useApp().exit(error) rejects waitUntilExit', async () => {
    function App() {
      const { exit } = useApp();
      Promise.resolve().then(() => exit(new Error('boom')));
      return <Text>hi</Text>;
    }
    const fakeStdout = makeFakeStdout(20, 5);
    const fakeStderr = makeFakeStdout(20, 5);
    const instance = render(<App />, { stdout: fakeStdout, stderr: fakeStderr });
    await expect(instance.waitUntilExit()).rejects.toThrow('boom');
  });
});

// helper: WriteStream-shaped object that captures writes
function makeFakeStdout(columns: number, rows: number): NodeJS.WriteStream {
  const buf: string[] = [];
  const stream = {
    columns,
    rows,
    isTTY: true as const,
    write: (s: string | Uint8Array) => {
      buf.push(typeof s === 'string' ? s : Buffer.from(s).toString('utf8'));
      return true;
    },
    on: () => stream,
    off: () => stream,
    once: () => stream,
    removeListener: () => stream,
  } as unknown as NodeJS.WriteStream;
  // expose the buffer for tests that want it
  (stream as unknown as { __buf: string[] }).__buf = buf;
  return stream;
}
```

- [ ] **Step 2: Run tests**

Run: `pnpm vitest run packages/react/src/render.test.tsx`
Expected: both new tests PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/react/src/render.test.tsx
git commit -m "test(react): useApp().exit() resolves and rejects waitUntilExit"
```

---

## Task 19: useStdout + SIGWINCH

**Files:**
- Modify: `packages/react/src/render.tsx`

- [ ] **Step 1: Move stdoutValue into React state so dimensions update on resize**

In `render.tsx`, restructure so the StdoutContext value is owned by a wrapper component that subscribes to SIGWINCH:

```tsx
import { useEffect, useState } from 'react';
// ... rest of imports

function StdoutProvider({ stdout, children }: { stdout: NodeJS.WriteStream; children: ReactNode }) {
  const [dims, setDims] = useState({ columns: stdout.columns ?? 80, rows: stdout.rows ?? 24 });
  useEffect(() => {
    if (!stdout.isTTY) return;
    const handler = () => setDims({ columns: stdout.columns ?? 80, rows: stdout.rows ?? 24 });
    stdout.on('resize', handler);
    return () => {
      stdout.off('resize', handler);
    };
  }, [stdout]);
  const value: StdoutHookValue = {
    stdout,
    write: (s) => stdout.write(s),
    columns: dims.columns,
    rows: dims.rows,
  };
  return createElement(StdoutContext.Provider, { value }, children);
}
```

Replace the manual provider chain in `render()` with:
```tsx
  const wrapped = createElement(
    AppContext.Provider,
    { value: appValue },
    createElement(
      StdoutProvider,
      { stdout },
      createElement(StderrContext.Provider, { value: stderrValue }, element),
    ),
  );
```

Also: when dimensions change, the root container's `width`/`height` need to update so the engine re-lays out. Add a second effect that mutates `rootNode` and triggers a redraw. Cleanest approach: bridge the resize via a React effect at the very top of the tree:

```tsx
function ResizeBridge({ rootNode, container, onResize, children }: {
  rootNode: ContainerNode;
  container: RootContainer;
  onResize: () => void;
  children: ReactNode;
}) {
  // Subscribe to dimensions from useStdout (provided by parent StdoutProvider).
  // When they change, mutate the rootNode and trigger a redraw via a state bump.
  const { columns, rows } = useStdout();
  const [, force] = useState(0);
  useEffect(() => {
    rootNode.width = columns;
    rootNode.height = rows;
    container.prevFrame = null; // force full repaint on next commit
    force((n) => n + 1);
  }, [columns, rows, rootNode, container]);
  return <>{children}</>;
}
```

And update the wrapper chain:
```tsx
  const wrapped = createElement(
    AppContext.Provider,
    { value: appValue },
    createElement(
      StdoutProvider,
      { stdout },
      createElement(
        ResizeBridge,
        { rootNode, container, onResize: () => {} },
        createElement(StderrContext.Provider, { value: stderrValue }, element),
      ),
    ),
  );
```

- [ ] **Step 2: Add a SIGWINCH simulation test**

Append to `render.test.tsx`:

```tsx
it('useStdout reflects resize via stdout.emit("resize")', async () => {
  function App() {
    const { columns, rows } = useStdout();
    return <Text>{`${columns}x${rows}`}</Text>;
  }
  const stdout = makeFakeStdout(20, 5);
  // Make stdout an event-emitter so 'resize' can be simulated.
  const { EventEmitter } = await import('node:events');
  const ee = new EventEmitter();
  (stdout as unknown as { on: typeof ee.on; off: typeof ee.off; emit: typeof ee.emit }).on = ee.on.bind(ee);
  (stdout as unknown as { off: typeof ee.off }).off = ee.off.bind(ee);
  (stdout as unknown as { emit: typeof ee.emit }).emit = ee.emit.bind(ee);
  const writes = (stdout as unknown as { __buf: string[] }).__buf;

  const instance = render(<App />, { stdout, stderr: makeFakeStdout(20, 5) });
  expect(stripAnsi(writes.join(''))).toContain('20x5');

  // simulate resize
  (stdout as unknown as { columns: number }).columns = 30;
  (stdout as unknown as { rows: number }).rows = 8;
  ee.emit('resize');
  // give effect time to run
  await new Promise((r) => setTimeout(r, 0));
  expect(stripAnsi(writes.join(''))).toContain('30x8');

  instance.unmount();
});
```

- [ ] **Step 3: Run tests**

Run: `pnpm vitest run packages/react/src/render.test.tsx`
Expected: all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/react/src/render.tsx packages/react/src/render.test.tsx
git commit -m "feat(react): useStdout reflects SIGWINCH; full repaint on resize"
```

---

## Task 20: Public barrel and type re-exports

**Files:**
- Modify: `packages/react/src/index.ts`

- [ ] **Step 1: Replace placeholder index with full barrel**

```ts
export const VERSION = '0.1.0-rc.1';

// Public components
export { Box, Newline, Spacer, Text } from './components.js';
export type { BoxProps, TextProps } from './components.js';

// Hooks
export { useApp, useStdout, useStderr } from './hooks.js';
export type { AppHookValue, StdoutHookValue, StderrHookValue } from './hooks.js';

// Render entry
export { render } from './render.js';
export type { RenderOptions, RenderInstance } from './render.js';

// Type re-exports from @pilates/render so consumers get one import path
export type {
  Align,
  BorderStyle,
  Color,
  EdgeValue,
  FlexDirection,
  FlexWrap,
  Justify,
  NamedColor,
  PositionType,
  Wrap,
} from '@pilates/render';
```

- [ ] **Step 2: Build to confirm no missing exports**

Run: `pnpm --filter @pilates/react build`
Expected: build succeeds, `dist/index.d.ts` includes all expected exports.

- [ ] **Step 3: Commit**

```bash
git add packages/react/src/index.ts
git commit -m "feat(react): public barrel with type re-exports"
```

---

## Task 21: Stream error handling

**Files:**
- Modify: `packages/react/src/render.tsx`
- Modify: `packages/react/src/render.test.tsx`

- [ ] **Step 1: Subscribe to stdout 'error' events**

In `render.tsx`, just before `reconciler.updateContainer`, add:

```tsx
  const onStreamError = (err: Error) => {
    if (unmounted) return;
    unmounted = true;
    reconciler.updateContainer(null, handle, null, () => {});
    stdout.off?.('error', onStreamError);
    rejectExit(err);
  };
  if (typeof stdout.on === 'function') stdout.on('error', onStreamError);
```

And in `instance.unmount`, before `reconciler.updateContainer(null, ...)`, also detach:
```tsx
      if (typeof stdout.off === 'function') stdout.off('error', onStreamError);
```

- [ ] **Step 2: Add a test simulating EPIPE**

Append to `render.test.tsx`:

```tsx
it('rejects waitUntilExit when stdout emits an error', async () => {
  const { EventEmitter } = await import('node:events');
  const ee = new EventEmitter();
  const stdout = makeFakeStdout(20, 5);
  (stdout as unknown as { on: typeof ee.on; off: typeof ee.off; emit: typeof ee.emit }).on = ee.on.bind(ee);
  (stdout as unknown as { off: typeof ee.off }).off = ee.off.bind(ee);
  (stdout as unknown as { emit: typeof ee.emit }).emit = ee.emit.bind(ee);

  const instance = render(<Text>x</Text>, { stdout, stderr: makeFakeStdout(20, 5) });
  ee.emit('error', new Error('EPIPE'));
  await expect(instance.waitUntilExit()).rejects.toThrow('EPIPE');
});
```

- [ ] **Step 3: Run tests**

Run: `pnpm vitest run packages/react/src/render.test.tsx`
Expected: all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/react/src/render.tsx packages/react/src/render.test.tsx
git commit -m "feat(react): stream errors reject waitUntilExit"
```

---

## Task 22: <Text> validation error path

**Files:**
- Modify: `packages/react/src/render.test.tsx`

The throw is already wired up (Task 4 + Task 5/7). This task verifies it surfaces correctly through the reconciler.

- [ ] **Step 1: Add a test that an invalid Text child throws**

Append to `render.test.tsx`:

```tsx
describe('validation', () => {
  it('throws when <Text> contains a <Box>', () => {
    expect(() =>
      renderToString(
        <Text>
          <Box width={1} height={1} />
        </Text>,
        { width: 5, height: 1 },
      ),
    ).toThrow(/<Text> children must be string, number, <Text>, or <Newline>/);
  });

  it('throws when bare strings appear at the root', () => {
    // React filters out `false` / `null`, so we use an explicit string
    expect(() => renderToString(<>{'bare'}</>, { width: 5, height: 1 })).toThrow(
      /bare strings are not allowed/,
    );
  });

  it('component-thrown render error rejects waitUntilExit and writes to stderr', async () => {
    function Boom(): never {
      throw new Error('kaboom');
    }
    const stdout = makeFakeStdout(20, 5);
    const stderr = makeFakeStdout(20, 5);
    const stderrBuf = (stderr as unknown as { __buf: string[] }).__buf;
    const instance = render(<Boom />, { stdout, stderr });
    await expect(instance.waitUntilExit()).rejects.toThrow('kaboom');
    expect(stderrBuf.join('')).toContain('Pilates render error');
  });
});
```

The `makeFakeStdout` helper is the one defined in Task 18.

- [ ] **Step 2: Run tests**

Run: `pnpm vitest run packages/react/src/render.test.tsx`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/react/src/render.test.tsx
git commit -m "test(react): invalid Text children, bare root strings, and component throws"
```

---

## Task 23: example — react-counter

**Files:**
- Create: `examples/react-counter/package.json`
- Create: `examples/react-counter/index.tsx`
- Create: `examples/react-counter/README.md`

- [ ] **Step 1: Create example**

`examples/react-counter/package.json`:
```json
{
  "name": "@pilates-examples/react-counter",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./index.tsx",
  "scripts": {
    "dev": "tsx index.tsx"
  },
  "dependencies": {
    "@pilates/react": "workspace:*",
    "react": "^19.0.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "tsx": "^4.19.2"
  }
}
```

`examples/react-counter/index.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { Box, render, Text, useApp } from '@pilates/react';

export function App() {
  const [n, setN] = useState(0);
  const { exit } = useApp();
  useEffect(() => {
    const id = setInterval(() => setN((x) => x + 1), 250);
    const stop = setTimeout(() => {
      clearInterval(id);
      exit();
    }, 3000);
    return () => {
      clearInterval(id);
      clearTimeout(stop);
    };
  }, [exit]);
  return (
    <Box border="single" padding={1} width={20} height={5} flexDirection="column">
      <Text bold color="cyan">
        counter
      </Text>
      <Text>n = {n}</Text>
    </Box>
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const instance = render(<App />);
  await instance.waitUntilExit();
}
```

`examples/react-counter/README.md`:
```markdown
# react-counter

Minimal `@pilates/react` example: a counter that increments every 250ms for 3s, demonstrating the diff-based redraw loop.

```bash
pnpm --filter @pilates-examples/react-counter dev
```
```

- [ ] **Step 2: Run pnpm install to wire the new workspace package**

Run: `pnpm install`
Expected: `examples/react-counter` linked.

- [ ] **Step 3: Verify the example runs (smoke check, can be Ctrl-C'd if it's interactive)**

Run: `pnpm --filter @pilates-examples/react-counter dev`
Expected: counter renders for 3 seconds, then exits cleanly. Cursor lands on a fresh line.

- [ ] **Step 4: Add a smoke test**

Append to `packages/react/src/render.test.tsx`:

```tsx
describe('examples smoke', () => {
  it('react-counter App renders without throwing', async () => {
    const { App } = await import('../../../examples/react-counter/index.js');
    const out = stripAnsi(renderToString(<App />, { width: 22, height: 7 }));
    expect(out).toContain('counter');
    expect(out).toContain('n = 0');
  });
});
```

Note the import path must match the example's runtime — adjust if `tsx` is needed for resolution. If the test environment can't resolve the example's TSX file directly (vitest can — it uses esbuild), use `await import('@pilates-examples/react-counter')` after adding `"main": "./index.tsx"` to the example's package.json (already in step 1).

- [ ] **Step 5: Run the smoke test**

Run: `pnpm vitest run packages/react/src/render.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add examples/react-counter pnpm-lock.yaml packages/react/src/render.test.tsx
git commit -m "feat(examples): react-counter + smoke test"
```

---

## Task 24: example — react-dashboard

**Files:**
- Create: `examples/react-dashboard/package.json`
- Create: `examples/react-dashboard/index.tsx`
- Create: `examples/react-dashboard/README.md`

- [ ] **Step 1: Create example mirroring `examples/dashboard/index.ts` shape**

`examples/react-dashboard/package.json`:
```json
{
  "name": "@pilates-examples/react-dashboard",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./index.tsx",
  "scripts": {
    "dev": "tsx index.tsx"
  },
  "dependencies": {
    "@pilates/react": "workspace:*",
    "react": "^19.0.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "tsx": "^4.19.2"
  }
}
```

`examples/react-dashboard/index.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { Box, render, Text, useApp, useStdout } from '@pilates/react';

interface Tile {
  title: string;
  value: string;
  detail?: string;
  color: 'green' | 'yellow' | 'red' | 'cyan' | 'magenta';
}

export function App() {
  const { columns: cols, rows } = useStdout();
  const { exit } = useApp();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 500);
    return () => clearInterval(id);
  }, []);

  const tiles: Tile[] = [
    { title: 'CPU', value: `${(40 + (tick % 20)).toFixed(0)}%`, detail: 'load 1.4', color: 'green' },
    { title: 'Memory', value: '8.2 GB', detail: '/ 16 GB', color: 'cyan' },
    { title: 'Disk', value: '124 GB', detail: '/ 500 GB', color: 'cyan' },
    { title: 'Network', value: `${10 + (tick % 5)} MB/s`, detail: '↓ 8  ↑ 4', color: 'magenta' },
  ];
  const tileWidth = Math.floor((cols - 2 - tiles.length * 2 - 2) / tiles.length);

  return (
    <Box width={cols} height={rows} flexDirection="column">
      <Box height={3} border="single" title="Pilates Dashboard"
           flexDirection="row" justifyContent="space-between" alignItems="center">
        <Text color="green" bold>● running</Text>
        <Text color="gray">tick {tick}</Text>
      </Box>
      <Box flex={1} flexDirection="row" alignItems="flex-start"
           gap={{ column: 2 }} padding={1}>
        {tiles.map((t) => (
          <Box key={t.title} width={tileWidth} height={4} border="rounded" title={t.title}>
            <Text color={t.color} bold>{t.value}</Text>
            <Text color="gray">{t.detail ?? ''}</Text>
          </Box>
        ))}
      </Box>
      <Box height={3} border="single">
        <Box height={1} flexDirection="row" justifyContent="space-around" alignItems="center">
          <Text color="green">read 412/s</Text>
          <Text color="cyan">write 87/s</Text>
          <Text color="green">errors 0</Text>
          <Text color="gray">latency 4ms</Text>
        </Box>
      </Box>
    </Box>
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const instance = render(<App />);
  setTimeout(() => instance.unmount(), 3000);
  await instance.waitUntilExit();
}
```

`examples/react-dashboard/README.md`:
```markdown
# react-dashboard

`@pilates/react` port of `examples/dashboard`. Layout mirrors the imperative version, with a live `tick` counter on the header so you can see incremental redraws in action.

```bash
pnpm --filter @pilates-examples/react-dashboard dev
```
```

- [ ] **Step 2: Add smoke test**

Append to `render.test.tsx`:

```tsx
it('react-dashboard App renders without throwing', async () => {
  const { App } = await import('../../../examples/react-dashboard/index.js');
  const out = renderToString(<App />, { width: 60, height: 12 });
  expect(out.length).toBeGreaterThan(0);
  expect(stripAnsi(out)).toContain('Pilates Dashboard');
});
```

- [ ] **Step 3: pnpm install + run smoke test**

Run: `pnpm install && pnpm vitest run packages/react/src/render.test.tsx`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add examples/react-dashboard pnpm-lock.yaml packages/react/src/render.test.tsx
git commit -m "feat(examples): react-dashboard + smoke test"
```

---

## Task 25: example — react-modal

**Files:**
- Create: `examples/react-modal/package.json`
- Create: `examples/react-modal/index.tsx`
- Create: `examples/react-modal/README.md`

- [ ] **Step 1: Create the example**

`examples/react-modal/package.json` — same shape as react-dashboard's, change name to `@pilates-examples/react-modal`.

`examples/react-modal/index.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { Box, render, Text, useApp, useStdout } from '@pilates/react';

export function App() {
  const { columns: cols, rows } = useStdout();
  const { exit } = useApp();
  const [open, setOpen] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setOpen((o) => !o), 1500);
    const stop = setTimeout(() => exit(), 3000);
    return () => {
      clearTimeout(t);
      clearTimeout(stop);
    };
  }, [exit]);

  const users = ['alice', 'bob', 'carol', 'dave', 'eve', 'frank', 'grace', 'henry', 'ivy', 'jack'];
  const modalWidth = 36;
  const modalHeight = 7;
  const modalLeft = Math.floor((cols - modalWidth) / 2);
  const modalTop = Math.floor((rows - modalHeight) / 2);

  return (
    <Box width={cols} height={rows} flexDirection="column">
      <Box flex={1} border="single" title="App">
        <Text color="cyan" bold>users:</Text>
        {users.map((u) => (
          <Text key={u}>{` ├ ${u}`}</Text>
        ))}
      </Box>
      {open && (
        <Box
          positionType="absolute"
          position={{ top: modalTop, left: modalLeft }}
          width={modalWidth}
          height={modalHeight}
          border="rounded"
          borderColor="yellow"
          title="Confirm action"
          titleColor="yellow"
          flexDirection="column"
          justifyContent="space-between"
          padding={{ top: 1, bottom: 1, left: 2, right: 2 }}
        >
          <Text bold>Delete user "carol"?</Text>
          <Box height={1} flexDirection="row" justifyContent="space-around">
            <Text color="gray">[ cancel ]</Text>
            <Text color="red" bold>[ delete ]</Text>
          </Box>
        </Box>
      )}
    </Box>
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const instance = render(<App />);
  await instance.waitUntilExit();
}
```

`examples/react-modal/README.md` — short blurb (~5 lines) like the others.

- [ ] **Step 2: Add smoke test**

Append to `render.test.tsx`:

```tsx
it('react-modal App renders without throwing', async () => {
  const { App } = await import('../../../examples/react-modal/index.js');
  const out = renderToString(<App />, { width: 60, height: 16 });
  expect(stripAnsi(out)).toContain('Confirm action');
});
```

- [ ] **Step 3: pnpm install + run tests**

Run: `pnpm install && pnpm vitest run packages/react/src/render.test.tsx`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add examples/react-modal pnpm-lock.yaml packages/react/src/render.test.tsx
git commit -m "feat(examples): react-modal + smoke test"
```

---

## Task 26: Full README for `@pilates/react`

**Files:**
- Modify: `packages/react/README.md`

- [ ] **Step 1: Replace placeholder with full README**

Write a ~150 line README covering:
- TL;DR with one code sample (Box / Text / useState counter)
- Installation block (`npm install @pilates/react@next react@^19`)
- Components table (Box, Text, Spacer, Newline) with prop summaries
- Hooks table (useApp, useStdout, useStderr) with shape
- A "What's NOT in v0.1" section listing the deferred APIs (input hooks, Static, Transform, nested-Text style inheritance) so users searching for them find the answer fast
- A note that this is an RC; report bugs at the issues link

The exact markdown is left to the engineer; match the tone and structure of `packages/render/README.md`.

- [ ] **Step 2: Commit**

```bash
git add packages/react/README.md
git commit -m "docs(react): full package README"
```

---

## Task 27: CHANGELOG entry + root README mention

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `README.md` (root)

- [ ] **Step 1: Prepend `@pilates/react@0.1.0-rc.1` section to CHANGELOG.md**

Add at the top (under any unreleased section, above existing `@pilates/diff@0.1.0`):

```markdown
## @pilates/react@0.1.0-rc.1 — 2026-MM-DD

Initial pre-release.

- React reconciler driving `@pilates/core` + `@pilates/render` + `@pilates/diff`
- Components: `Box`, `Text`, `Spacer`, `Newline`
- Hooks: `useApp`, `useStdout`, `useStderr` (read-only, `exit()` on `useApp`)
- `render(<App />, options?)` returns `{ unmount, waitUntilExit }`
- Auto-resize via SIGWINCH; full-repaint on resize, incremental redraws otherwise
- React 19+ peer; `react-reconciler@^0.31`
- Published with `next` dist-tag; install via `npm install @pilates/react@next`
```

(Replace `MM-DD` with the actual publish date.)

- [ ] **Step 2: Update root README's package list**

Find the existing list of packages (core / render / diff) in `README.md` and add a row for `@pilates/react`:

```markdown
| `@pilates/react`  | React reconciler — author terminal UIs with JSX and hooks  | `0.1.0-rc.1` (pre-release) |
```

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md README.md
git commit -m "docs: CHANGELOG and root README entries for @pilates/react"
```

---

## Task 28: Final verification + publish dry-run

**Files:** none modified.

- [ ] **Step 1: Run the full CI suite**

Run: `pnpm run ci`
Expected: lint clean, build clean, typecheck clean, tests **252+** passing (229 baseline + ~23 new).

- [ ] **Step 2: Smoke-run all three examples**

Run sequentially:
```bash
pnpm --filter @pilates-examples/react-counter dev
pnpm --filter @pilates-examples/react-dashboard dev
pnpm --filter @pilates-examples/react-modal dev
```
Expected: each renders, animates, and exits cleanly. No stuck cursors, no leftover ANSI sequences in the scrollback after exit.

- [ ] **Step 3: Publish dry-run**

Run: `cd packages/react && pwd && pnpm publish --dry-run --access=public --no-git-checks --tag next`
Expected: `pwd` shows `packages/react` (NOT the repo root). The dry run lists files in `dist/` + `README.md`, no source `.ts`/`.tsx` leakage. Total package size under ~30 KB.

- [ ] **Step 4: Per-package git tag**

Run: `git tag '@pilates/react@0.1.0-rc.1'`

- [ ] **Step 5: Real publish (only after user explicitly approves)**

This step requires explicit user authorization. Do NOT run automatically.

User will run (or tell the engineer to run):
```bash
cd packages/react && pwd && pnpm publish --access=public --no-git-checks --tag next
git push --tags
```

- [ ] **Step 6: Verify on npm**

Run: `npm view @pilates/react`
Expected: shows `@pilates/react@0.1.0-rc.1`, `dist-tags: { next: '0.1.0-rc.1' }`. **The `latest` tag should NOT exist** (this is the pre-release contract).

- [ ] **Step 7: Final commit if anything was tweaked during verification**

```bash
git add -A
git commit -m "chore(react): final verification fixes" || echo "nothing to commit"
```

---

## Self-review notes

**Spec coverage:**

| Spec section | Implementing tasks |
|---|---|
| Strategic decisions table | Task 1 (deps + tsconfig), Task 10 (component names) |
| Architecture / package layout | Task 1 (scaffolding), Tasks 3–10 (each src file) |
| Public API surface | Task 10 (components), Task 16 (hooks), Task 17 (render), Task 20 (barrel + re-exports) |
| Data flow / lifecycle | Tasks 5–9 (HostConfig), Task 17 (render entry), Task 19 (SIGWINCH) |
| Error handling — render errors | Task 17 (onUncaughtError), Task 22 (test) |
| Error handling — Text validation | Task 4 (flatten throws), Task 5 (appendChild throws), Task 22 (test) |
| Error handling — stream errors | Task 21 (impl + test) |
| Testing — 5 categories | Task 12 (static), Task 13 (re-render diff), Task 14 (conditional), Task 15 (composition), Task 18 + 19 (hooks) |
| Verification before publish | Task 28 |
| Publish | Task 28 (dry-run + user-gated real publish) |

**Placeholder scan:** No "TBD" / "figure out" / "implement later" / "add appropriate error handling" remaining. Every task has concrete code blocks and concrete commands with expected output.

**Type consistency:** `RootContainer.onFlush` (defined Task 3, used Tasks 9/11/17). `prevFrame` (defined Task 3, used Tasks 9/11/17). Discriminators `kind: 'box' | 'text' | 'fragment'` consistent across reconciler.ts, host-config.ts, text-flatten.ts. `TextFragment.parent` is the back-pointer set in `appendChildImpl` (Task 5), `insertBeforeImpl` (Task 7), and read in `commitTextUpdate` (Task 8). `TextInstance.fragments` holds `TextFragment | TextInstance` refs (defined Task 3, used Tasks 4/5/7/8 consistently).

---

**END OF PLAN**
