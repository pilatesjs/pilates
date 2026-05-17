/**
 * `SpinelessLayout` — drives the Spineless incremental layout engine
 * as a `calculateLayout`-equivalent (phase 8).
 *
 * The grammar (`buildFlexGrammar`) + runtime (`SpinelessRuntime`)
 * compute each node's `{width, height, left, top}` in floating-point
 * space; this driver writes those into `node._layout`, then runs the
 * shared integer-cell rounding (`roundLayout`) and scroll-extent
 * pass — mirroring the tail of the imperative `calculateLayoutImpl`.
 *
 * The driver persists the grammar + runtime between `layout()` calls.
 * It picks one of three paths per call:
 *
 *   - VALUE relayout (v20) — nothing structural changed; re-`markDirty`
 *     the input Fields whose value drifted and `recompute()`.
 *   - GRAFT relayout (v21) — the only structural change is a single
 *     child append; `buildAppendFragment` + `graft` patch the runtime
 *     in place, no whole-tree rebuild.
 *   - full REBUILD — any other structural change (`flex-direction`,
 *     an `'auto'` ↔ numeric flip, a flex weight crossing zero, a
 *     child removed or mid-list inserted, a reverse-parent append, …).
 *
 * @internal
 */

import type { MeasureFunc } from '../../measure-func.js';
import type { Node } from '../../node.js';
import { roundLayout } from '../round.js';
import {
  type AvailableSize,
  type FlexGrammarOutput,
  buildAppendFragment,
  buildFlexGrammar,
} from './flex-grammar.js';
import type { Field, Grammar, ReadFn } from './grammar.js';
import { SpinelessRuntime } from './runtime.js';

/** Every leaf input Field (`deps: []`) the runtime currently tracks. */
function collectInputs(grammar: Grammar, runtime: SpinelessRuntime): Array<Field<unknown>> {
  const inputs: Array<Field<unknown>> = [];
  for (const [field, rule] of grammar) {
    if (rule.deps.length === 0 && runtime.isTracked(field)) inputs.push(field);
  }
  return inputs;
}

/** An input field's `compute` never calls `read` — guard against it. */
const NEVER_READ: ReadFn = () => {
  throw new Error('[spineless-layout] an input field compute must not read');
};

/**
 * Per-node structural fingerprint — the state that, when changed,
 * reshapes the grammar's rule graph and so needs a fresh build.
 * Captured pre-order; parallel arrays so a tree-shape change shows
 * up as a length / identity mismatch.
 */
interface StructuralFingerprint {
  nodes: Node[];
  sigs: string[];
  measures: (MeasureFunc | null)[];
}

/** The structural signature of one node — see `StructuralFingerprint`. */
function nodeSig(node: Node): string {
  const s = node.style;
  return [
    s.flexDirection,
    s.flexWrap,
    s.justifyContent,
    s.alignItems,
    s.alignContent,
    s.alignSelf,
    s.positionType,
    s.display,
    typeof s.width,
    typeof s.height,
    typeof s.flexBasis,
    // Only the zero / positive BOUNDARY of a flex weight is
    // structural (it flips `parentNeedsFlexDistribution`); a
    // positive → positive tweak stays an incremental value change.
    s.flexGrow > 0 ? 'g' : '_',
    s.flexShrink > 0 ? 's' : '_',
    // `aspectRatio` is captured by value at build time, so any
    // change to it needs a rebuild.
    s.aspectRatio === undefined ? 'n' : String(s.aspectRatio),
    // Absolute children capture their `position` edges by value.
    s.position
      .map((p) => (p === undefined ? '_' : String(p)))
      .join(','),
  ].join('|');
  // Tree shape is NOT in the signature — `StructuralFingerprint`'s
  // `nodes` array already captures every child insert / remove.
}

function captureStructure(root: Node): StructuralFingerprint {
  const nodes: Node[] = [];
  const sigs: string[] = [];
  const measures: (MeasureFunc | null)[] = [];
  function visit(n: Node): void {
    nodes.push(n);
    sigs.push(nodeSig(n));
    measures.push(n.getMeasureFunc());
    for (let i = 0; i < n.getChildCount(); i++) visit(n.getChild(i)!);
  }
  visit(root);
  return { nodes, sigs, measures };
}

function structureEqual(a: StructuralFingerprint, b: StructuralFingerprint): boolean {
  if (a.nodes.length !== b.nodes.length) return false;
  for (let i = 0; i < a.nodes.length; i++) {
    if (a.nodes[i] !== b.nodes[i]) return false;
    if (a.sigs[i] !== b.sigs[i]) return false;
    if (a.measures[i] !== b.measures[i]) return false;
  }
  return true;
}

/** Persistent state from the last full build. */
interface Built {
  /** Mutated in place when `available` values change incrementally. */
  available: AvailableSize;
  output: FlexGrammarOutput;
  runtime: SpinelessRuntime;
  /** Every leaf input Field (`deps: []`) the runtime tracks. */
  inputs: Array<Field<unknown>>;
  structure: StructuralFingerprint;
}

/**
 * A layout driver bound to one root `Node`. Call `layout()` to
 * produce a layout byte-equivalent to imperative `calculateLayout`;
 * repeat calls reuse the runtime when only values changed.
 *
 * @internal
 */
export class SpinelessLayout {
  private readonly root: Node;
  private built: Built | null = null;

  /** Build / relayout counters — for tests and diagnostics. */
  readonly stats = { fullBuilds: 0, incrementalRelayouts: 0, graftRelayouts: 0 };

  constructor(root: Node) {
    this.root = root;
  }

  /**
   * Lay the tree out. `availableWidth` / `availableHeight` size an
   * `'auto'` root, matching `calculateLayout`'s availability args.
   */
  layout(availableWidth?: number, availableHeight?: number): void {
    const current = captureStructure(this.root);
    // `available` PRESENCE (defined vs not) is structural — it
    // selects the root size rule shape (`rootAxisIsBareZero`).
    const samePresence =
      this.built !== null &&
      (this.built.available.width !== undefined) === (availableWidth !== undefined) &&
      (this.built.available.height !== undefined) === (availableHeight !== undefined);

    if (samePresence && structureEqual(current, this.built!.structure)) {
      // Nothing structural changed — incremental value relayout.
      this.applyValueChanges(availableWidth, availableHeight);
      this.stats.incrementalRelayouts++;
    } else if (samePresence && this.tryGraftAppend(current, availableWidth, availableHeight)) {
      // A single child append — patched in place via `graft`.
      this.stats.graftRelayouts++;
    } else {
      this.fullBuild(current, availableWidth, availableHeight);
      this.stats.fullBuilds++;
    }

    this.writeBack();
    roundLayout(this.root);
    recordScrollSizes(this.root);
    clearDirtyDeep(this.root);
  }

  /** Discard any persisted state and build the grammar afresh. */
  private fullBuild(
    current: StructuralFingerprint,
    availableWidth?: number,
    availableHeight?: number,
  ): void {
    const available: AvailableSize = {};
    if (availableWidth !== undefined) available.width = availableWidth;
    if (availableHeight !== undefined) available.height = availableHeight;

    const output = buildFlexGrammar(this.root, available);
    const rootFields: Field<unknown>[] = [];
    for (const f of output.allFields) {
      rootFields.push(f.width, f.height, f.left, f.top);
    }
    const runtime = new SpinelessRuntime(output.grammar, rootFields);
    runtime.init();

    this.built = {
      available,
      output,
      runtime,
      inputs: collectInputs(output.grammar, runtime),
      structure: current,
    };
  }

  /**
   * Fast-path a structural change that is exactly a single child
   * append: `buildAppendFragment` + `graft`, no whole-tree rebuild.
   * Returns `false` (and changes nothing) when the change is not a
   * clean append the fast-path covers — the caller then rebuilds.
   */
  private tryGraftAppend(
    current: StructuralFingerprint,
    availableWidth?: number,
    availableHeight?: number,
  ): boolean {
    const built = this.built!;
    const prevNodes = new Set(built.structure.nodes);
    const curNodes = new Set(current.nodes);

    // A pure append: no node removed, at least one added.
    for (const n of built.structure.nodes) {
      if (!curNodes.has(n)) return false;
    }
    const added = current.nodes.filter((n) => !prevNodes.has(n));
    if (added.length === 0) return false;

    // No surviving node's own structural signature may have changed
    // — `graft` patches only the append, nothing else.
    const sigByNode = new Map<Node, string>();
    const measureByNode = new Map<Node, MeasureFunc | null>();
    for (let i = 0; i < current.nodes.length; i++) {
      sigByNode.set(current.nodes[i]!, current.sigs[i]!);
      measureByNode.set(current.nodes[i]!, current.measures[i]!);
    }
    for (let i = 0; i < built.structure.nodes.length; i++) {
      const n = built.structure.nodes[i]!;
      if (sigByNode.get(n) !== built.structure.sigs[i]) return false;
      if (measureByNode.get(n) !== built.structure.measures[i]) return false;
    }

    // The added nodes must form exactly one subtree — its root is
    // the unique added node whose parent is NOT itself added.
    const addedSet = new Set(added);
    let child: Node | null = null;
    for (const n of added) {
      const p = n.getParent();
      if (p === null || !addedSet.has(p)) {
        if (child !== null) return false; // two separate appends
        child = n;
      }
    }
    if (child === null) return false;
    const parent = child.getParent();
    if (parent === null) return false;

    const fragment = buildAppendFragment(built.output, this.root, parent, child);
    if (fragment === null) return false;

    built.runtime.graft(fragment.additions, fragment.newRoots);
    for (const [field, rule] of fragment.rebinds) built.runtime.rebindRule(field, rule);
    built.output = fragment.next;
    built.inputs = collectInputs(fragment.next.grammar, built.runtime);
    built.structure = current;

    // Pick up any value mutations that landed in the same gap, then
    // recompute (covering the grafted / rebound fields too).
    this.applyValueChanges(availableWidth, availableHeight);
    return true;
  }

  /**
   * Re-`markDirty` every input Field whose live value drifted from
   * the runtime's cached value, then `recompute()`. The grammar is
   * assumed unchanged (or already patched by `graft`).
   */
  private applyValueChanges(availableWidth?: number, availableHeight?: number): void {
    const built = this.built!;
    // `available` values feed `available:*` input Fields via the
    // closure over this object — mutate it in place so the diff
    // below picks the change up.
    if (availableWidth !== undefined) built.available.width = availableWidth;
    if (availableHeight !== undefined) built.available.height = availableHeight;

    const { runtime, output } = built;
    for (const field of built.inputs) {
      const live = output.grammar.get(field)!.compute(NEVER_READ);
      if (live !== runtime.evaluate(field)) runtime.markDirty(field);
    }
    runtime.recompute();
  }

  /** Write the runtime's float layout into every node's `_layout`. */
  private writeBack(): void {
    const { runtime, output } = this.built!;
    for (const f of output.allFields) {
      const node = f.node;
      const left = runtime.evaluate(f.left);
      const top = runtime.evaluate(f.top);
      node._layout.left = left;
      node._layout.top = top;
      node._layout.width = runtime.evaluate(f.width);
      node._layout.height = runtime.evaluate(f.height);
      node._floatLeft = left;
      node._floatTop = top;
    }
  }
}

/**
 * Post-order walk recording each node's content bounding box on
 * `_layout.scrollWidth` / `scrollHeight`. Mirrors the scroll-extent
 * half of `calculateLayoutImpl`'s `computeScrollSizes` — without the
 * imperative layout-cache writes, which belong to the imperative
 * path only.
 */
function recordScrollSizes(node: Node): void {
  for (let i = 0; i < node.getChildCount(); i++) recordScrollSizes(node.getChild(i)!);
  let contentRight = 0;
  let contentBottom = 0;
  for (let i = 0; i < node.getChildCount(); i++) {
    const cl = node.getChild(i)!._layout;
    contentRight = Math.max(contentRight, cl.left + cl.width);
    contentBottom = Math.max(contentBottom, cl.top + cl.height);
  }
  node._layout.scrollWidth = Math.max(node._layout.width, contentRight);
  node._layout.scrollHeight = Math.max(node._layout.height, contentBottom);
}

function clearDirtyDeep(node: Node): void {
  node.clearDirty();
  for (let i = 0; i < node.getChildCount(); i++) clearDirtyDeep(node.getChild(i)!);
}
