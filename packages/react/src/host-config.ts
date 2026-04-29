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

function appendChildToContainer(container: RootContainer, child: AnyInstance): void {
  if (child.kind === 'fragment') {
    throw new Error('Pilates: bare strings are not allowed at the root. Wrap them in <Text>.');
  }
  container.root.children = container.root.children ?? [];
  (container.root.children as RenderNode[]).push(child.node);
}
