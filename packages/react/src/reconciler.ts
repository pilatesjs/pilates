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
  fragments: Array<TextFragment | TextInstance>;
}

export interface TextFragment {
  kind: 'fragment';
  text: string;
  parent: TextInstance | null;
}

export type HostInstance = BoxInstance | TextInstance;
export type AnyInstance = HostInstance | TextFragment;

export interface RootContainer {
  root: ContainerNode;
  prevFrame: Frame | null;
  onFlush: (ansi: string) => void;
}
