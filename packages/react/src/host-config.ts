import type { HostConfig } from 'react-reconciler';
import { DefaultEventPriority } from 'react-reconciler/constants.js';
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
    getPublicInstance: (instance) => instance as HostInstance,
    prepareForCommit: () => null,
    resetAfterCommit: TODO('resetAfterCommit'),
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
    insertInContainerBefore: (container, child, before) => insertBeforeContainerImpl(container, child, before),
    removeChild: (parent, child) => removeChildImpl(parent, child),
    removeChildFromContainer: (container, child) => removeChildFromContainerImpl(container, child),
    prepareUpdate: TODO('prepareUpdate') as never,
    commitUpdate: TODO('commitUpdate') as never,
    commitTextUpdate: TODO('commitTextUpdate') as never,
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

function finalizeText(instance: HostInstance): void {
  if (instance.kind !== 'text') return;
  instance.node.text = flattenText(instance);
}

function appendChildToContainer(container: RootContainer, child: AnyInstance): void {
  if (child.kind === 'fragment') {
    throw new Error('Pilates: bare strings are not allowed at the root. Wrap them in <Text>.');
  }
  container.root.children = container.root.children ?? [];
  (container.root.children as RenderNode[]).push(child.node);
}

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
