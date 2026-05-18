/**
 * `SpinelessLayout` — drives the Spineless incremental layout engine
 * as a `calculateLayout`-equivalent (phase 8).
 *
 * The grammar (`buildFlexGrammar`) + runtime (`SpinelessRuntime`)
 * compute each node's `{width, height, left, top}` in floating-point
 * space; this driver writes those into `node._layout`, then runs
 * integer-cell rounding and a scroll-extent pass — mirroring the
 * tail of the imperative `calculateLayoutImpl`.
 *
 * The driver persists the grammar + runtime between `layout()` calls
 * and keeps every step incremental:
 *
 *   - DETECTION (v22) — the `Node` dirty flags scope change detection
 *     to the mutated region.
 *   - VALUE relayout — `recompute()` reports the fields it changed;
 *     write-back, rounding and scroll-extents (v23) touch only the
 *     subtrees whose layout actually moved.
 *   - GRAFT relayout (v21) — a single child append patches the
 *     runtime via `buildAppendFragment` + `graft`.
 *   - full REBUILD — any other structural change.
 *
 * @internal
 */

import type { MeasureFunc } from '../../measure-func.js';
import type { Node } from '../../node.js';
import { roundLayout, roundLayoutFrom } from '../round.js';
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

/** A node's four layout-output Fields. */
interface LayoutFields {
  width: Field<number>;
  height: Field<number>;
  left: Field<number>;
  top: Field<number>;
}

/**
 * A record of what one `SpinelessLayout.layout()` call did — the
 * observability surface phase 9 builds on. `path` names the engine
 * route; the counts quantify how incremental the call was.
 *
 * @internal
 */
export interface LayoutTrace {
  /** Engine path this `layout()` call took. */
  path: 'build' | 'graft' | 'incremental';
  /** Nodes the dirty-flag walk classified as dirty (0 on a build). */
  dirtyNodes: number;
  /** Grammar Fields the runtime re-ran (0 on a pure build — a build
   *  computes every Field once during `init`, not via `recompute`). */
  fieldsRecomputed: number;
  /** Of those, Fields whose value actually changed. */
  fieldsChanged: number;
  /** Maximal moved-subtree roots written back. 0 on build / graft —
   *  those finish whole-tree. */
  movedSubtrees: number;
}

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
  for (const k of [
    'width',
    'height',
    'flexBasis',
    'flexGrow',
    'flexShrink',
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

/** Clear the dirty flags over the same region `collectDirty` walks. */
function clearDirtyRegion(node: Node): void {
  if (!node.isDirty() && !node._hasDirtyDescendant) return;
  node.clearDirty();
  for (let i = 0; i < node.getChildCount(); i++) clearDirtyRegion(node.getChild(i)!);
}

function clearDirtyDeep(node: Node): void {
  node.clearDirty();
  for (let i = 0; i < node.getChildCount(); i++) clearDirtyDeep(node.getChild(i)!);
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
  /** A node's four layout-output Fields. */
  fields: Map<Node, LayoutFields>;
  /** Reverse index: a layout Field → the node that owns it. */
  owner: Map<Field<unknown>, Node>;
}

/** Build the `fields` / `owner` indexes from a `FlexGrammarOutput`. */
function indexFields(output: FlexGrammarOutput): Pick<Built, 'fields' | 'owner'> {
  const fields = new Map<Node, LayoutFields>();
  const owner = new Map<Field<unknown>, Node>();
  for (const f of output.allFields) {
    fields.set(f.node, { width: f.width, height: f.height, left: f.left, top: f.top });
    owner.set(f.width as Field<unknown>, f.node);
    owner.set(f.height as Field<unknown>, f.node);
    owner.set(f.left as Field<unknown>, f.node);
    owner.set(f.top as Field<unknown>, f.node);
  }
  return { fields, owner };
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

  /** What the most recent `layout()` call did (phase 9). */
  private _lastTrace: LayoutTrace | null = null;

  constructor(root: Node) {
    this.root = root;
  }

  /** The `LayoutTrace` of the most recent `layout()` call, or `null`
   *  if `layout()` has not run yet. */
  get lastTrace(): LayoutTrace | null {
    return this._lastTrace;
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
      this.finishWhole();
      return;
    }

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
      const moved = this.relayoutValues(dirty, availableWidth, availableHeight);
      this.stats.incrementalRelayouts++;
      const rs = this.built!.runtime.stats;
      this._lastTrace = {
        path: 'incremental',
        dirtyNodes: dirty.length,
        fieldsRecomputed: rs.recomputeVisited,
        fieldsChanged: rs.recomputeChanged,
        movedSubtrees: moved.length,
      };
      this.finishIncremental(moved);
      clearDirtyRegion(this.root);
      return;
    }
    if (this.tryGraftAppend(availableWidth, availableHeight)) {
      this.stats.graftRelayouts++;
      const rs = this.built!.runtime.stats;
      this._lastTrace = {
        path: 'graft',
        dirtyNodes: dirty.length,
        fieldsRecomputed: rs.recomputeVisited,
        fieldsChanged: rs.recomputeChanged,
        movedSubtrees: 0,
      };
    } else {
      this.fullBuild(availableWidth, availableHeight);
      this.stats.fullBuilds++;
    }
    this.finishWhole();
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
      ...indexFields(output),
    };

    // A build computes every Field once during `init` (counted by
    // `runtime.stats.initFields`) — it runs no `recompute()`, so the
    // recompute-derived trace counts are all zero.
    this._lastTrace = {
      path: 'build',
      dirtyNodes: 0,
      fieldsRecomputed: 0,
      fieldsChanged: 0,
      movedSubtrees: 0,
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

    // No surviving node's signature / measure may have changed —
    // `graft` patches only the append.
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
    const idx = indexFields(fragment.next);
    built.fields = idx.fields;
    built.owner = idx.owner;

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
   * then `recompute()`. Returns the maximal subtree roots whose
   * layout moved — for `finishIncremental` to write back.
   */
  private relayoutValues(dirty: Node[], availableWidth?: number, availableHeight?: number): Node[] {
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
      // `styleInputs` can hold an input Field no rule reads (e.g. a
      // flex-start container's main-END padding) — untracked, and a
      // change to it cannot move any layout field. Skip it.
      if (!runtime.isTracked(field)) continue;
      const live = output.grammar.get(field)!.compute(NEVER_READ);
      if (live !== runtime.evaluate(field)) runtime.markDirty(field);
    }

    // The changed layout Fields name the nodes whose box moved.
    const changed = runtime.recompute();
    const moved = new Set<Node>();
    for (const f of changed) {
      const n = built.owner.get(f);
      if (n !== undefined) moved.add(n);
    }
    // Keep only the maximal moved subtree roots — a moved node with
    // no moved ancestor. Re-rounding such a root covers its whole
    // (shifted) subtree.
    const roots: Node[] = [];
    for (const n of moved) {
      let maximal = true;
      for (let p = n.getParent(); p !== null; p = p.getParent()) {
        if (moved.has(p)) {
          maximal = false;
          break;
        }
      }
      if (maximal) roots.push(n);
    }
    return roots;
  }

  /** Push new `available` values into the holder the grammar closes over. */
  private applyAvailable(availableWidth?: number, availableHeight?: number): void {
    const a = this.built!.available;
    if (availableWidth !== undefined) a.width = availableWidth;
    if (availableHeight !== undefined) a.height = availableHeight;
  }

  /** Write-back + round + scroll the whole tree (after a build / graft). */
  private finishWhole(): void {
    const { runtime, output } = this.built!;
    for (const f of output.allFields) {
      writeNode(f.node, runtime, { width: f.width, height: f.height, left: f.left, top: f.top });
    }
    roundLayout(this.root);
    recordScrollSizes(this.root);
    clearDirtyDeep(this.root);
  }

  /**
   * Write-back + round + scroll, scoped to the subtrees that moved.
   * A moved subtree's parent did not move, so its rounding is stable
   * and the subtree can be re-rounded in isolation; only that
   * parent's own scroll extent then needs a recompute.
   */
  private finishIncremental(roots: Node[]): void {
    const { runtime, fields } = this.built!;
    for (const root of roots) {
      // Write the float layout for the whole moved subtree, so the
      // re-round below has float values throughout.
      const stack: Node[] = [root];
      while (stack.length > 0) {
        const n = stack.pop()!;
        writeNode(n, runtime, fields.get(n)!);
        for (let i = 0; i < n.getChildCount(); i++) stack.push(n.getChild(i)!);
      }
      const pos = ancestorPositions(root);
      roundLayoutFrom(root, pos.floatX, pos.floatY, pos.roundedX, pos.roundedY);
      recordScrollSizes(root);
    }
    // A moved root's parent did not move, so `recordScrollSizes`
    // above never touched it — but one of its children's box did
    // change, so its own scroll extent needs a recompute.
    const scrollParents = new Set<Node>();
    for (const root of roots) {
      const p = root.getParent();
      if (p !== null) scrollParents.add(p);
    }
    for (const p of scrollParents) recomputeScroll(p);
  }
}

/** Write one node's evaluated float layout into `_layout`. */
function writeNode(node: Node, runtime: SpinelessRuntime, f: LayoutFields): void {
  const left = runtime.evaluate(f.left);
  const top = runtime.evaluate(f.top);
  node._layout.left = left;
  node._layout.top = top;
  node._layout.width = runtime.evaluate(f.width);
  node._layout.height = runtime.evaluate(f.height);
  node._floatLeft = left;
  node._floatTop = top;
}

/**
 * The float and rounded absolute position of `node`'s parent — the
 * origin `roundLayoutFrom` needs to re-round the `node` subtree. The
 * ancestors did not move, so their `_floatLeft/Top` (float) and
 * `_layout.left/top` (rounded) are still current.
 */
function ancestorPositions(node: Node): {
  floatX: number;
  floatY: number;
  roundedX: number;
  roundedY: number;
} {
  let floatX = 0;
  let floatY = 0;
  let roundedX = 0;
  let roundedY = 0;
  for (let a = node.getParent(); a !== null; a = a.getParent()) {
    floatX += a._floatLeft;
    floatY += a._floatTop;
    roundedX += a._layout.left;
    roundedY += a._layout.top;
  }
  return { floatX, floatY, roundedX, roundedY };
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
  recomputeScroll(node);
}

/** Recompute one node's scroll extent from its direct children's boxes. */
function recomputeScroll(node: Node): void {
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
