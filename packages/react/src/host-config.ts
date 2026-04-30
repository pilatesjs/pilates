import { applyDiff, diff } from '@pilates/diff';
import type { RenderNode } from '@pilates/render';
import { renderToFrame } from '@pilates/render';
import type { HostConfig } from 'react-reconciler';
import { DefaultEventPriority, DiscreteEventPriority } from 'react-reconciler/constants.js';
import type {
  AnyInstance,
  BoxInstance,
  HostInstance,
  RootContainer,
  TextFragment,
  TextInstance,
} from './reconciler.js';
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

type PilatesHostConfig = HostConfig<
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
>;

export function buildHostConfig(): PilatesHostConfig {
  // react-reconciler@0.31 routes update priority through three host
  // methods (resolveUpdatePriority / getCurrentUpdatePriority /
  // setCurrentUpdatePriority). They aren't in the @types/react-reconciler
  // @0.28.9 HostConfig surface yet, so we attach them via cast below.
  let currentUpdatePriority = DefaultEventPriority;
  const base: PilatesHostConfig = {
    supportsMutation: true,
    supportsPersistence: false,
    supportsHydration: false,
    isPrimaryRenderer: true,
    noTimeout: -1,
    scheduleTimeout: setTimeout,
    cancelTimeout: clearTimeout,
    getRootHostContext: () => ({}),
    getChildHostContext: (parent) => parent,
    getPublicInstance: (instance) => instance as HostInstance,
    prepareForCommit: () => null,
    resetAfterCommit: (container) => {
      const next = renderToFrame(container.root);
      const changes = diff(container.prevFrame, next);
      const ansi = applyDiff(changes);
      container.prevFrame = next;
      if (ansi.length > 0) container.onFlush(ansi);
    },
    preparePortalMount: () => {},
    shouldSetTextContent: () => false,
    createInstance: (type, props) => createInstance(type, props),
    createTextInstance: (text) => ({ kind: 'fragment', text, parent: null }),
    appendInitialChild: (parent, child) => appendChildImpl(parent, child),
    finalizeInitialChildren: (instance) => {
      finalizeText(instance);
      return false; // don't request commitMount
    },
    appendChild: (parent, child) => appendChildImpl(parent, child),
    appendChildToContainer: (container, child) => appendChildToContainer(container, child),
    insertBefore: (parent, child, before) => insertBeforeImpl(parent, child, before),
    insertInContainerBefore: (container, child, before) =>
      insertBeforeContainerImpl(container, child, before),
    removeChild: (parent, child) => removeChildImpl(parent, child),
    removeChildFromContainer: (container, child) => removeChildFromContainerImpl(container, child),
    // react-reconciler@0.31 dropped prepareUpdate entirely — props comparison
    // moved into the reconciler core, and commitUpdate runs unconditionally
    // when props change. The @types/react-reconciler@0.28.9 surface still
    // requires this slot, so we keep a no-op stub for type compat. The 0.31
    // runtime never invokes it.
    prepareUpdate: () => null,
    // react-reconciler@0.31 also changed commitUpdate's argument layout,
    // dropping `updatePayload` and adding the source Fiber:
    //   0.28: (instance, payload, type, oldProps, newProps, fiber)
    //   0.31: (instance, type, oldProps, newProps, fiber)
    // Parameters are positional, so the @0.28 type signature lands the
    // 0.31 newProps in the slot the type calls `Type` (a string). Cast
    // through `unknown` to recover its actual Record shape, then mutate
    // instance.node in place.
    commitUpdate: (instance, _typeArg, runtimeNewProps) => {
      const newProps = runtimeNewProps as unknown as Record<string, unknown>;
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
    clearContainer: (container) => {
      container.root.children = [];
    },
    detachDeletedInstance: () => {},
    getCurrentEventPriority: () => DefaultEventPriority,
    getInstanceFromNode: () => null,
    beforeActiveInstanceBlur: () => {},
    afterActiveInstanceBlur: () => {},
    prepareScopeUpdate: () => {},
    getInstanceFromScope: () => null,
  };
  // The 0.31 runtime expects these four extra methods. Cast through
  // `unknown` because the older @types/react-reconciler doesn't list them.
  //
  // resolveUpdatePriority returns DiscreteEventPriority (sync lane) so
  // that setState calls outside any React event still schedule work at
  // sync priority — drained synchronously by flushSyncWork(). This
  // matches the v0.1 LegacyRoot model: every commit is sync.
  return {
    ...base,
    resolveUpdatePriority: () => DiscreteEventPriority,
    getCurrentUpdatePriority: () => currentUpdatePriority,
    setCurrentUpdatePriority: (priority: number) => {
      currentUpdatePriority = priority;
    },
    maySuspendCommit: () => false,
  } as unknown as PilatesHostConfig;
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
      // Re-append: drop any prior occurrence so a move ends up at the
      // tail rather than producing a duplicate entry. The DOM does this
      // for you; an array-backed host has to do it manually.
      const oldIdx = parent.fragments.indexOf(child);
      if (oldIdx !== -1) parent.fragments.splice(oldIdx, 1);
      parent.fragments.push(child);
      // Re-flatten so node.text reflects the new ordering.
      parent.node.text = flattenText(parent);
      return;
    }
    if (child.kind === 'text') {
      const oldIdx = parent.fragments.indexOf(child);
      if (oldIdx !== -1) parent.fragments.splice(oldIdx, 1);
      parent.fragments.push(child);
      parent.node.text = flattenText(parent);
      return;
    }
    throw new Error(
      `Pilates: <Text> children must be string, number, <Text>, or <Newline>. Got: ${(child as { kind?: string }).kind}`,
    );
  }
  // Box parent
  if (child.kind === 'fragment') {
    throw new Error(
      'Pilates: bare strings are not allowed as <Box> children. Wrap them in <Text>.',
    );
  }
  parent.node.children = parent.node.children ?? [];
  const arr = parent.node.children as RenderNode[];
  const oldIdx = arr.indexOf(child.node);
  if (oldIdx !== -1) arr.splice(oldIdx, 1);
  arr.push(child.node);
}

function finalizeText(instance: HostInstance): void {
  if (instance.kind !== 'text') return;
  instance.node.text = flattenText(instance);
}

function appendChildToContainer(container: RootContainer, child: AnyInstance): void {
  if (child.kind === 'fragment') {
    throw new Error('Pilates: bare strings are not allowed at the root. Wrap them in <Text>.');
  }
  container.root.children = container.root.children ?? [];
  const arr = container.root.children as RenderNode[];
  const oldIdx = arr.indexOf(child.node);
  if (oldIdx !== -1) arr.splice(oldIdx, 1);
  arr.push(child.node);
}

function insertBeforeImpl(parent: HostInstance, child: AnyInstance, before: AnyInstance): void {
  if (parent.kind === 'text') {
    if (child.kind === 'fragment' || child.kind === 'text') {
      if (child.kind === 'fragment') child.parent = parent;
      // Drop any prior occurrence first so a move re-positions the
      // child rather than duplicating it.
      const oldIdx = parent.fragments.indexOf(child as TextFragment | TextInstance);
      if (oldIdx !== -1) parent.fragments.splice(oldIdx, 1);
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
    throw new Error(
      'Pilates: bare strings are not allowed as <Box> children. Wrap them in <Text>.',
    );
  }
  if (before.kind === 'fragment') {
    throw new Error('Pilates: invariant — Box children should never be string fragments.');
  }
  parent.node.children ??= [];
  const arr = parent.node.children as RenderNode[];
  const oldIdx = arr.indexOf(child.node);
  if (oldIdx !== -1) arr.splice(oldIdx, 1);
  const idx = arr.indexOf(before.node);
  if (idx === -1) arr.push(child.node);
  else arr.splice(idx, 0, child.node);
}

function insertBeforeContainerImpl(
  container: RootContainer,
  child: AnyInstance,
  before: AnyInstance,
): void {
  if (child.kind === 'fragment') {
    throw new Error('Pilates: bare strings are not allowed at the root. Wrap them in <Text>.');
  }
  if (before.kind === 'fragment') {
    throw new Error('Pilates: invariant — root children should never be string fragments.');
  }
  container.root.children ??= [];
  const arr = container.root.children as RenderNode[];
  const oldIdx = arr.indexOf(child.node);
  if (oldIdx !== -1) arr.splice(oldIdx, 1);
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
