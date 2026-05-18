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
 * It uses the `Node` dirty flags (`isDirty()` / `_hasDirtyDescendant`)
 * to scope change detection to the mutated region — so a repeat
 * `layout()` after a small mutation is O(dirty region), not O(tree).
 * Each call picks one of three paths:
 *
 *   - VALUE relayout — every dirty node is a pure value mutation;
 *     re-`markDirty` just those nodes' input Fields and `recompute()`.
 *   - GRAFT relayout — the only structural change is a single child
 *     append; `buildAppendFragment` + `graft` patch the runtime.
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
  type StyleInputs,
  buildAppendFragment,
  buildFlexGrammar,
} from './flex-grammar.js';
import type { Field, Grammar, ReadFn } from './grammar.js';
import { SpinelessRuntime } from './runtime.js';

/** An input field's `compute` never calls `read` — guard against it. */
const NEVER_READ: ReadFn = () => {
  throw new Error('[spineless-layout] an input field compute must not read');
};

/** Every leaf input Field (`deps: []`) the runtime currently tracks. */
function collectInputs(grammar: Grammar, runtime: SpinelessRuntime): Array<Field<unknown>> {
  const inputs: Array<Field<unknown>> = [];
  for (const [field, rule] of grammar) {
    if (rule.deps.length === 0 && runtime.isTracked(field)) inputs.push(field);
  }
  return inputs;
}

/** The leaf input Fields a single node owns (its style inputs). */
function inputFieldsOf(entry: StyleInputs | undefined, out: Array<Field<unknown>>): void {
  if (entry === undefined) return;
  for (const k of ['width', 'height', 'flexBasis', 'flexGrow', 'flexShrink'] as const) {
    const f = entry[k];
    if (f !== undefined) out.push(f as Field<unknown>);
  }
  for (const k of [
    'gapRow',
    'gapColumn',
    'minWidth',
    'minHeight',
    'maxWidth',
    'maxHeight',
  ] as const) {
    const f = entry[k];
    if (f !== undefined) out.push(f as Field<unknown>);
  }
  for (const k of ['padding', 'margin'] as const) {
    const arr = entry[k];
    if (arr === undefined) continue;
    for (const f of arr) if (f !== undefined) out.push(f as Field<unknown>);
  }
}

/**
 * The per-node state that, when changed, reshapes the grammar's rule
 * graph — so a mismatch needs a graft or a full rebuild rather than
 * a value relayout.
 */
interface NodeSnap {
  sig: string;
  measure: MeasureFunc | null;
  children: Node[];
}

/** The structural signature of one node — see `NodeSnap`. */
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
}

function captureSnaps(root: Node): Map<Node, NodeSnap> {
  const snaps = new Map<Node, NodeSnap>();
  function visit(n: Node): void {
    const children: Node[] = [];
    for (let i = 0; i < n.getChildCount(); i++) children.push(n.getChild(i)!);
    snaps.set(n, { sig: nodeSig(n), measure: n.getMeasureFunc(), children });
    for (const c of children) visit(c);
  }
  visit(root);
  return snaps;
}

/** True iff `node`'s current child list still matches `snap.children`. */
function childrenUnchanged(snap: NodeSnap, node: Node): boolean {
  if (node.getChildCount() !== snap.children.length) return false;
  for (let i = 0; i < snap.children.length; i++) {
    if (node.getChild(i) !== snap.children[i]) return false;
  }
  return true;
}

/**
 * Collect every dirty node — descending only into subtrees the dirty
 * flags say contain a change, so the walk is O(dirty region).
 */
function collectDirty(node: Node, out: Node[]): void {
  const dirty = node.isDirty();
  if (dirty) out.push(node);
  if (dirty || node._hasDirtyDescendant) {
    for (let i = 0; i < node.getChildCount(); i++) collectDirty(node.getChild(i)!, out);
  }
}

/** Persistent state from the last full build (or graft). */
interface Built {
  /** Mutated in place when `available` values change incrementally. */
  available: AvailableSize;
  output: FlexGrammarOutput;
  runtime: SpinelessRuntime;
  /** Every leaf input Field (`deps: []`) the runtime tracks. */
  inputs: Array<Field<unknown>>;
  /** Per-node structural snapshot, for the dirty-walk classifier. */
  snaps: Map<Node, NodeSnap>;
}

/**
 * A layout driver bound to one root `Node`. Call `layout()` to
 * produce a layout byte-equivalent to imperative `calculateLayout`;
 * repeat calls reuse the runtime, relaying incrementally.
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
    // `available` PRESENCE (defined vs not) is structural — it
    // selects the root size rule shape (`rootAxisIsBareZero`).
    const samePresence =
      this.built !== null &&
      (this.built.available.width !== undefined) === (availableWidth !== undefined) &&
      (this.built.available.height !== undefined) === (availableHeight !== undefined);

    if (!samePresence) {
      this.fullBuild(availableWidth, availableHeight);
      this.stats.fullBuilds++;
    } else {
      // Classify the dirty region: any structural change forces the
      // graft / rebuild paths; otherwise it is a pure value relayout.
      const dirty: Node[] = [];
      collectDirty(this.root, dirty);
      const snaps = this.built!.snaps;
      let structural = false;
      for (const n of dirty) {
        const snap = snaps.get(n);
        if (
          snap === undefined ||
          snap.sig !== nodeSig(n) ||
          snap.measure !== n.getMeasureFunc() ||
          !childrenUnchanged(snap, n)
        ) {
          structural = true;
          break;
        }
      }

      if (!structural) {
        this.relayoutValues(dirty, availableWidth, availableHeight);
        this.stats.incrementalRelayouts++;
      } else if (this.tryGraftAppend(availableWidth, availableHeight)) {
        this.stats.graftRelayouts++;
      } else {
        this.fullBuild(availableWidth, availableHeight);
        this.stats.fullBuilds++;
      }
    }

    this.writeBack();
    roundLayout(this.root);
    recordScrollSizes(this.root);
    clearDirtyDeep(this.root);
  }

  /** Discard any persisted state and build the grammar afresh. */
  private fullBuild(availableWidth?: number, availableHeight?: number): void {
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
      snaps: captureSnaps(this.root),
    };
  }

  /**
   * Fast-path a structural change that is exactly a single child
   * append: `buildAppendFragment` + `graft`, no whole-tree rebuild.
   * Returns `false` (and changes nothing) when the change is not a
   * clean append the fast-path covers — the caller then rebuilds.
   */
  private tryGraftAppend(availableWidth?: number, availableHeight?: number): boolean {
    const built = this.built!;
    const snaps = built.snaps;

    // Walk the current tree; no previously-snapshotted node may be
    // gone (a removal is not an append), and at least one must be new.
    const curNodes = new Set<Node>();
    (function visit(n: Node): void {
      curNodes.add(n);
      for (let i = 0; i < n.getChildCount(); i++) visit(n.getChild(i)!);
    })(this.root);
    for (const n of snaps.keys()) {
      if (!curNodes.has(n)) return false;
    }
    const added: Node[] = [];
    for (const n of curNodes) {
      if (!snaps.has(n)) added.push(n);
    }
    if (added.length === 0) return false;

    // No surviving node's signature / measure / non-append child set
    // may have changed — `graft` patches only the append.
    for (const [n, snap] of snaps) {
      if (snap.sig !== nodeSig(n) || snap.measure !== n.getMeasureFunc()) return false;
    }

    // The added nodes must form exactly one subtree — its root is the
    // unique added node whose parent is not itself added.
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
    built.snaps = captureSnaps(this.root);

    // Pick up any value mutations in the same gap, then recompute
    // (covering the grafted / rebound fields too).
    this.applyAvailable(availableWidth, availableHeight);
    for (const field of built.inputs) {
      if (built.output.grammar.get(field)!.compute(NEVER_READ) !== built.runtime.evaluate(field)) {
        built.runtime.markDirty(field);
      }
    }
    built.runtime.recompute();
    return true;
  }

  /**
   * Value relayout: re-`markDirty` only the input Fields of the dirty
   * nodes (plus the root `available:*` inputs) whose value drifted,
   * then `recompute()`. O(dirty region), not O(tree).
   */
  private relayoutValues(dirty: Node[], availableWidth?: number, availableHeight?: number): void {
    const built = this.built!;
    this.applyAvailable(availableWidth, availableHeight);

    const fields: Array<Field<unknown>> = [];
    if (built.output.availableInputs.width !== undefined) {
      fields.push(built.output.availableInputs.width as Field<unknown>);
    }
    if (built.output.availableInputs.height !== undefined) {
      fields.push(built.output.availableInputs.height as Field<unknown>);
    }
    for (const n of dirty) inputFieldsOf(built.output.styleInputs.get(n), fields);

    const { runtime, output } = built;
    for (const field of fields) {
      // `styleInputs` can hold an input Field the grammar registered
      // but no rule ever reads (e.g. a flex-start container's
      // main-END padding) — the runtime never tracked it, and a
      // change to it cannot move any layout field. Skip it.
      if (!runtime.isTracked(field)) continue;
      const live = output.grammar.get(field)!.compute(NEVER_READ);
      if (live !== runtime.evaluate(field)) runtime.markDirty(field);
    }
    runtime.recompute();
  }

  /** Push new `available` values into the holder the grammar closes over. */
  private applyAvailable(availableWidth?: number, availableHeight?: number): void {
    const a = this.built!.available;
    if (availableWidth !== undefined) a.width = availableWidth;
    if (availableHeight !== undefined) a.height = availableHeight;
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
