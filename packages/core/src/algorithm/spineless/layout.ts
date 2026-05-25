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
  buildRemoveFragment,
  buildReorderFragment,
} from './flex-grammar.js';
import { type Field, type Grammar, type ReadFn, field } from './grammar.js';
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
 * A record of what one layout call did — the observability surface
 * phase 9 builds on. `path` names the engine route; the counts
 * quantify how incremental the call was. Surfaced to consumers via
 * `setLayoutProfiler` (see `algorithm/index.ts`).
 */
export interface LayoutTrace {
  /**
   * Engine path the call took. `SpinelessLayout` sets `build` /
   * `graft` / `detach` / `reorder` / `incremental`; the public
   * `calculateLayout` reports `imperative` for a call the Spineless
   * engine did not serve (a root's first / cold layout).
   */
  path: 'imperative' | 'build' | 'graft' | 'detach' | 'reorder' | 'incremental';
  /** Nodes the dirty-flag walk classified as dirty (0 on a build). */
  dirtyNodes: number;
  /** Grammar Fields the runtime re-ran (0 on a pure build — a build
   *  computes every Field once during `init`, not via `recompute`). */
  fieldsRecomputed: number;
  /** Of those, Fields whose value actually changed. */
  fieldsChanged: number;
  /** Maximal moved-subtree roots written back. 0 on build — that path
   *  finishes the whole tree. Structural fast-paths report the scoped
   *  roots their `finishMoved` writes back. */
  movedSubtrees: number;
}

/** Every leaf input Field (`deps: []`) the runtime currently tracks. */
function collectInputs(grammar: Grammar, runtime: SpinelessRuntime): Set<Field<unknown>> {
  const inputs = new Set<Field<unknown>>();
  for (const [f, rule] of grammar) {
    if (rule.deps.length === 0 && runtime.isTracked(f)) inputs.add(f);
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
    // Fold-predicate bits for Phase 17: each bit flips when the
    // property crosses its fold boundary (default → non-default).
    // Mutating a folded property must change nodeSig so the
    // classifier triggers a grammar rebuild.
    s.minWidth === 0 ? '_' : 'mw',
    s.minHeight === 0 ? '_' : 'mh',
    s.maxWidth === undefined ? '_' : 'xw',
    s.maxHeight === undefined ? '_' : 'xh',
    s.margin[0] === 0 ? '_' : 'm0',
    s.margin[1] === 0 ? '_' : 'm1',
    s.margin[2] === 0 ? '_' : 'm2',
    s.margin[3] === 0 ? '_' : 'm3',
  ].join('|');
}

function captureSnaps(root: Node): Map<Node, NodeSnap> {
  const snaps = new Map<Node, NodeSnap>();
  captureSnapsInto(root, snaps);
  return snaps;
}

/** Write `node`'s subtree snaps into `target` (used by the
 *  fast-path graft to extend the snap map by the appended region
 *  without rewalking the whole tree). */
function captureSnapsInto(node: Node, target: Map<Node, NodeSnap>): void {
  const children: Node[] = [];
  for (let i = 0; i < node.getChildCount(); i++) children.push(node.getChild(i)!);
  target.set(node, { sig: nodeSig(node), measure: node.getMeasureFunc(), children });
  for (const c of children) captureSnapsInto(c, target);
}

/** A fresh `NodeSnap` for `node` against its current children. */
function freshSnap(node: Node): NodeSnap {
  const children: Node[] = [];
  for (let i = 0; i < node.getChildCount(); i++) children.push(node.getChild(i)!);
  return { sig: nodeSig(node), measure: node.getMeasureFunc(), children };
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
  inputs: Set<Field<unknown>>;
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
  readonly stats = {
    fullBuilds: 0,
    incrementalRelayouts: 0,
    graftRelayouts: 0,
    detachRelayouts: 0,
    reorderRelayouts: 0,
  };

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

    // Classify the dirty region. The classifier collects PIVOTS —
    // dirty nodes whose CHILDREN LIST changed since the last layout —
    // and short-circuits to a full rebuild when any snapped node's
    // sig / measure changed (those need a fresh grammar). A dirty
    // node WITHOUT a snap is a freshly-introduced node (part of an
    // appended subtree); the graft validator handles it, so the
    // classifier just skips it.
    //
    // Dispatch:
    //   - sig / measure change         → fullBuild
    //   - pivots.length === 0          → value relayout
    //   - pivots.length === 1          → graft / detach / reorder
    //   - pivots.length > 1            → fullBuild (multi-parent
    //                                     structural change; no
    //                                     fast-path handles it)
    const dirty: Node[] = [];
    collectDirty(this.root, dirty);
    const snaps = this.built!.snaps;
    const pivots: Node[] = [];
    let needsRebuild = false;
    for (const n of dirty) {
      const snap = snaps.get(n);
      if (snap === undefined) {
        // Freshly-introduced node — has no pre-layout snap. The graft
        // validator below verifies the new region forms one subtree
        // rooted under a single pivot; don't treat as a rebuild trigger.
        continue;
      }
      if (snap.sig !== nodeSig(n) || snap.measure !== n.getMeasureFunc()) {
        needsRebuild = true;
        break;
      }
      if (!childrenUnchanged(snap, n)) {
        pivots.push(n);
      }
    }

    if (!needsRebuild && pivots.length === 0) {
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
      this.finishMoved(moved, []);
      clearDirtyRegion(this.root);
      return;
    }

    if (!needsRebuild && pivots.length === 1) {
      const pivot = pivots[0]!;
      const graft = this.tryGraftAppend(pivot, dirty, availableWidth, availableHeight);
      if (graft !== null) {
        this.stats.graftRelayouts++;
        const rs = this.built!.runtime.stats;
        const survivorRoots = this.movedSubtreeRoots(graft.changed);
        // CRITICAL: include graft.child explicitly. Its fields were
        // computed via integrate() at graft time, not via recompute(),
        // so they don't appear in `changed`. Without this, a simple-
        // regime append (changed is empty) writes back NOTHING and
        // the appended subtree ships with _layout = 0. The structural-
        // differential fuzzer catches this.
        const roots = [graft.child, ...survivorRoots.filter((r) => !isInSubtree(r, graft.child))];
        this._lastTrace = {
          path: 'graft',
          dirtyNodes: dirty.length,
          fieldsRecomputed: rs.recomputeVisited,
          fieldsChanged: rs.recomputeChanged,
          movedSubtrees: roots.length,
        };
        this.finishMoved(roots, []);
        clearDirtyRegion(this.root);
        return;
      }

      const detach = this.tryDetachRemove(pivot, dirty, availableWidth, availableHeight);
      if (detach !== null) {
        this.stats.detachRelayouts++;
        const rs = this.built!.runtime.stats;
        const survivorRoots = this.movedSubtreeRoots(detach.changed);
        this._lastTrace = {
          path: 'detach',
          dirtyNodes: dirty.length,
          fieldsRecomputed: rs.recomputeVisited,
          fieldsChanged: rs.recomputeChanged,
          movedSubtrees: survivorRoots.length,
        };
        // Survivors may be empty for simple-regime removes; explicitly
        // include detach.parent so its scroll extent is recomputed.
        this.finishMoved(survivorRoots, [detach.parent]);
        clearDirtyRegion(this.root);
        return;
      }

      const reorder = this.tryReorder(pivot, dirty, availableWidth, availableHeight);
      if (reorder !== null) {
        this.stats.reorderRelayouts++;
        const rs = this.built!.runtime.stats;
        const movedRoots = this.movedSubtreeRoots(reorder.changed);
        this._lastTrace = {
          path: 'reorder',
          dirtyNodes: dirty.length,
          fieldsRecomputed: rs.recomputeVisited,
          fieldsChanged: rs.recomputeChanged,
          movedSubtrees: movedRoots.length,
        };
        this.finishMoved(movedRoots, [reorder.reordered]);
        clearDirtyRegion(this.root);
        return;
      }
    }

    this.fullBuild(availableWidth, availableHeight);
    this.stats.fullBuilds++;
    this.finishWhole(); // Only reached by fullBuild fallback now
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
   * append at `pivot`: `buildAppendFragment` + `graft`, no whole-tree
   * rebuild. Returns `null` (and changes nothing) when the change is
   * not a clean append the fast-path covers — the caller then tries
   * the next fast-path / rebuilds.
   *
   * The classifier supplies `pivot` — a dirty node whose snapshot
   * exists (so sig / measure are unchanged) and whose children list
   * differs from its snap's. The validator inspects ONLY pivot's
   * children, not the whole tree.
   */
  private tryGraftAppend(
    pivot: Node,
    dirty: Node[],
    availableWidth?: number,
    availableHeight?: number,
  ): { child: Node; changed: Array<Field<unknown>> } | null {
    const built = this.built!;
    const snaps = built.snaps;
    const snap = snaps.get(pivot)!;

    // Pivot's live children must be its snapped children with exactly
    // ONE inserted child (anywhere — last for simple regime, mid-list
    // for non-simple). Walk pivot's children positionally —
    // O(pivot's children), not O(tree).
    const live = pivot.getChildCount();
    const snapped = snap.children.length;
    if (live !== snapped + 1) return null;
    // Find the insertion index: the first position where pivot's live
    // child diverges from snap. After the new child, the tail must
    // match the rest of the snap.
    let insertAt = snapped; // default: appended at the end
    for (let i = 0; i < snapped; i++) {
      if (pivot.getChild(i) !== snap.children[i]) {
        insertAt = i;
        break;
      }
    }
    // Verify the tail past the insertion matches.
    for (let i = insertAt; i < snapped; i++) {
      if (pivot.getChild(i + 1) !== snap.children[i]) return null;
    }
    const child = pivot.getChild(insertAt)!;
    // A change inside a `display: 'none'` subtree: the hidden region
    // has no grammar fields to graft onto. A node with no entry in
    // `fields` is hidden (or under a hidden ancestor) — fall back to
    // a rebuild, which correctly skips the whole hidden subtree.
    if (!built.fields.has(pivot)) return null;

    // Every other dirty-with-no-snap node must be a descendant of
    // `child` (i.e. the appended subtree). The classifier already
    // collected them; if any escaped this subtree, it would be an
    // independent append elsewhere — handled by the multi-pivot
    // fullBuild fallback, but a single-pivot append must be tight.
    //
    // Verifying this requires walking just the appended subtree:
    // O(added subtree).
    const subtreeMembers = new Set<Node>();
    {
      const stack: Node[] = [child];
      while (stack.length > 0) {
        const n = stack.pop()!;
        subtreeMembers.add(n);
        for (let i = 0; i < n.getChildCount(); i++) stack.push(n.getChild(i)!);
      }
    }

    const fragment = buildAppendFragment(built.output, this.root, pivot, child, built.available);
    if (fragment === null) return null;

    built.runtime.graft(fragment.additions, fragment.newRoots);
    for (const [rf, rule] of fragment.rebinds) built.runtime.rebindRule(rf, rule);
    built.output = fragment.next;

    // Incremental bookkeeping (Part C):
    //
    // `built.snaps` — update pivot's snap (children list changed) and
    // add a fresh snap for every node in the appended subtree.
    built.snaps.set(pivot, freshSnap(pivot));
    captureSnapsInto(child, built.snaps);

    // `built.fields` / `built.owner` — every new layout field belongs
    // to a node in the appended subtree. Walk the subtree and gather
    // each node's four layout fields from `fragment.additions`. A
    // `display: 'none'` descendant has no fields (it isn't in
    // additions for its layout-field keys); skip it.
    for (const n of subtreeMembers) {
      if (n.style.display === 'none') continue;
      const w = field<number>(n, 'width');
      const h = field<number>(n, 'height');
      const l = field<number>(n, 'left');
      const t = field<number>(n, 'top');
      if (!fragment.next.grammar.has(w as Field<unknown>)) continue;
      built.fields.set(n, { width: w, height: h, left: l, top: t });
      built.owner.set(w as Field<unknown>, n);
      built.owner.set(h as Field<unknown>, n);
      built.owner.set(l as Field<unknown>, n);
      built.owner.set(t as Field<unknown>, n);
    }

    // `built.inputs` — add new leaf input fields from additions. For
    // simple regime nothing existing changes tracking, so this is
    // additive. For non-simple regime, existing inputs may have just
    // become tracked (e.g. the previous last child's main-END
    // margin); the runtime's tracking is post-graft, so filter the
    // OLD list to only tracked + add new tracked leaves.
    if (fragment.rebinds.length === 0) {
      // Simple regime: no existing input changed tracking — just
      // append the new tracked leaves.
      for (const [f, rule] of fragment.additions) {
        if (rule.deps.length === 0 && built.runtime.isTracked(f)) {
          built.inputs.add(f);
        }
      }
    } else {
      // Non-simple regime: existing inputs may have gained or lost
      // tracking. The cheapest correct update is a full recompute
      // (same cost as the fragment builder's O(tree) rebuild).
      built.inputs = collectInputs(fragment.next.grammar, built.runtime);
    }

    // Pick up any value mutations in the same gap, then recompute
    // (covering the grafted / rebound fields too). Iterate ONLY the
    // dirty nodes' inputs — every value mutation marks its node
    // dirty, so we don't need to scan the whole input set.
    this.applyAvailable(availableWidth, availableHeight);
    this.markDriftedInputs(dirty);
    const changed = built.runtime.recompute();
    return { child, changed };
  }

  /**
   * Fast-path a structural change that is exactly a single subtree
   * removal at `pivot`: `buildRemoveFragment` + `rebindRule` /
   * `detach`, no whole-tree rebuild. Returns `null` (changing nothing)
   * when the change is not a clean removal — the caller then tries
   * the next fast-path / rebuilds.
   *
   * `buildRemoveFragment` must see the removed `child` still attached
   * (its regime check reads the parent's live child list and it walks
   * the subtree for the fields to detach), but by the time `layout()`
   * runs the caller has already detached it — so the removed subtree
   * is briefly re-inserted at its old index for the fragment build,
   * then detached again.
   *
   * The classifier supplies `pivot` — the parent whose children list
   * differs from its snap's. The validator inspects ONLY pivot's
   * children, not the whole tree.
   */
  private tryDetachRemove(
    pivot: Node,
    dirty: Node[],
    availableWidth?: number,
    availableHeight?: number,
  ): { parent: Node; changed: Array<Field<unknown>> } | null {
    const built = this.built!;
    const snaps = built.snaps;
    const snap = snaps.get(pivot)!;
    const snapChildren = snap.children;

    // Pivot's live children must be its snapped children with exactly
    // one contiguous removal. Walk pivot's children positionally —
    // O(pivot's children), not O(tree).
    const liveCount = pivot.getChildCount();
    const snappedCount = snapChildren.length;
    if (liveCount >= snappedCount) return null;
    // Find the index where they diverge; this is the start of the
    // removed run.
    let removedStart = 0;
    while (
      removedStart < liveCount &&
      pivot.getChild(removedStart) === snapChildren[removedStart]
    ) {
      removedStart++;
    }
    const removedCount = snappedCount - liveCount;
    // Verify the snapped tail past the removed run still matches the
    // live tail.
    for (let i = removedStart; i < liveCount; i++) {
      if (pivot.getChild(i) !== snapChildren[i + removedCount]) return null;
    }
    // Single-child removal: simple-regime requirement. (A wider
    // contiguous removal would still be a valid fragment for
    // non-simple regime, but the fragment builder is single-`child`
    // only, so split-merge runs fall through to fullBuild.)
    if (removedCount !== 1) return null;
    const child = snapChildren[removedStart]!;
    // A removal inside a `display: 'none'` subtree: the hidden region
    // has no fields to `detach`. A node absent from `fields` is hidden
    // (or under a hidden ancestor) — rebuild instead.
    if (!built.fields.has(pivot)) return null;

    // The removed subtree's nodes must still be reachable from
    // `child` through SNAP edges (the live tree no longer has them).
    // Collect them via DFS over snaps.
    const removedNodes = new Set<Node>();
    {
      const stack: Node[] = [child];
      while (stack.length > 0) {
        const n = stack.pop()!;
        removedNodes.add(n);
        const cs = snaps.get(n);
        if (cs !== undefined) for (const c of cs.children) stack.push(c);
      }
    }

    // Re-attach `child` for the fragment build, then detach it again.
    pivot.insertChild(child, removedStart);
    const fragment = buildRemoveFragment(built.output, this.root, pivot, child, built.available);
    pivot.removeChild(child);
    if (fragment === null) return null;

    // Apply: rebind survivors FIRST (so they stop reading the removed
    // fields), then `detach`, then adopt the next grammar.
    for (const [f, rule] of fragment.rebinds) built.runtime.rebindRule(f, rule);
    const dropped = built.runtime.detach(fragment.removed);
    built.output = fragment.next;

    // Incremental bookkeeping (Part C):
    //
    // `built.snaps` — update pivot's snap (children list changed) and
    // drop the removed subtree's snaps.
    built.snaps.set(pivot, freshSnap(pivot));
    for (const n of removedNodes) built.snaps.delete(n);

    // `built.fields` / `built.owner` — drop the removed subtree's
    // entries. Each removed node may have had `display: 'none'` (no
    // entry) or normal layout fields — `built.fields.delete` on a
    // missing key is harmless; `built.owner.delete` likewise.
    for (const n of removedNodes) {
      const lf = built.fields.get(n);
      if (lf !== undefined) {
        built.owner.delete(lf.width as Field<unknown>);
        built.owner.delete(lf.height as Field<unknown>);
        built.owner.delete(lf.left as Field<unknown>);
        built.owner.delete(lf.top as Field<unknown>);
        built.fields.delete(n);
      }
    }

    // `built.inputs` — remove every field detach dropped (the removed
    // subtree's inputs + any survivor orphan-cleaned by detach).
    // O(|dropped|) — detach's returned set is complete by construction:
    // its `drop` closure is the single choke point for ALL removals,
    // including orphan-cleaned surviving deps (e.g. the previous last
    // child's now-unread main-end margin). Set.delete is a no-op for
    // absent keys, so iterating all of `dropped` (which includes
    // non-input layout fields) correctly removes only the dropped
    // leaf inputs from `built.inputs`.
    for (const f of dropped) built.inputs.delete(f);

    // Pick up any value mutations in the same batch, then recompute.
    // Iterate ONLY the dirty nodes' inputs — every value mutation
    // marks its node dirty.
    this.applyAvailable(availableWidth, availableHeight);
    this.markDriftedInputs(dirty);
    const changed = built.runtime.recompute();
    return { parent: pivot, changed };
  }

  /**
   * Fast-path a structural change that is exactly `pivot`'s children
   * being reordered (a permutation — no node added or removed):
   * `buildReorderFragment` + `rebindRule`, no whole-tree rebuild.
   * Returns `null` (changing nothing) when the change is not a clean
   * single-parent reorder — the caller then rebuilds.
   *
   * The classifier supplies `pivot` — the single node whose children
   * list differs from its snap's. The validator inspects ONLY pivot's
   * children, not the whole tree.
   */
  private tryReorder(
    pivot: Node,
    dirty: Node[],
    availableWidth?: number,
    availableHeight?: number,
  ): { reordered: Node; changed: Array<Field<unknown>> } | null {
    const built = this.built!;
    const snap = built.snaps.get(pivot)!;

    // Pivot's children must be a permutation of the snapped set
    // (same count, same members). Otherwise it is an add/remove —
    // tryGraftAppend / tryDetachRemove would have caught it.
    const before = snap.children;
    if (before.length !== pivot.getChildCount()) return null;
    const beforeSet = new Set(before);
    for (let i = 0; i < pivot.getChildCount(); i++) {
      if (!beforeSet.has(pivot.getChild(i)!)) return null;
    }

    // A reorder inside a `display: 'none'` subtree touches no laid-out
    // node — the hidden region has no fields. Rebuild instead.
    if (!built.fields.has(pivot)) return null;

    const fragment = buildReorderFragment(built.output, this.root, pivot, built.available);
    // Order: integrate the newly-read inputs, rebind the rewritten
    // rules (their new deps are now all present), then detach the
    // inputs no rebound rule reads any more.
    built.runtime.graft(fragment.additions, fragment.newRoots);
    for (const [f, rule] of fragment.rebinds) built.runtime.rebindRule(f, rule);
    if (fragment.removed.length > 0) built.runtime.detach(fragment.removed);
    built.output = fragment.next;

    // Incremental bookkeeping (Part C):
    //
    // `built.snaps` — pivot's children list changed; everything else
    // stayed put. Update just pivot's snap.
    built.snaps.set(pivot, freshSnap(pivot));
    // `built.fields` / `built.owner` — the same nodes own the same
    // four layout fields they did before; no entry adds or drops.
    // (Field identity is stable across grammar rebuilds.)
    //
    // `built.inputs` — a reorder can newly-track or newly-untrack
    // sibling main-end margins (`additions` / `removed`). Update
    // incrementally.
    if (fragment.removed.length > 0) {
      for (const f of fragment.removed) built.inputs.delete(f);
    }
    for (const [f, rule] of fragment.additions) {
      if (rule.deps.length === 0 && built.runtime.isTracked(f)) {
        built.inputs.add(f);
      }
    }

    // Pick up any value mutations in the same batch, then recompute.
    // Iterate ONLY the dirty nodes' inputs — every value mutation
    // marks its node dirty.
    this.applyAvailable(availableWidth, availableHeight);
    this.markDriftedInputs(dirty);
    const changed = built.runtime.recompute();
    return { reordered: pivot, changed };
  }

  /**
   * Value relayout: re-`markDirty` only the input Fields of the dirty
   * nodes (plus the root `available:*` inputs) whose value drifted,
   * then `recompute()`. Returns the maximal subtree roots whose
   * layout moved — for `finishMoved` to write back.
   */
  private relayoutValues(dirty: Node[], availableWidth?: number, availableHeight?: number): Node[] {
    this.applyAvailable(availableWidth, availableHeight);
    this.markDriftedInputs(dirty);
    return this.movedSubtreeRoots(this.built!.runtime.recompute());
  }

  /**
   * Re-`markDirty` only the input Fields of the dirty nodes (plus the
   * root `available:*` inputs) whose live value drifted from the
   * runtime's stored value. Shared by every relayout path — the value
   * relayout and all three structural fast-paths.
   *
   * Iterates O(dirty inputs), not O(built.inputs) — every value
   * mutation marks its owning node dirty, so non-dirty nodes can't
   * have drifted inputs.
   */
  private markDriftedInputs(dirty: Iterable<Node>): void {
    const built = this.built!;
    const fields: Array<Field<unknown>> = [];
    if (built.output.availableInputs.width !== undefined) {
      fields.push(built.output.availableInputs.width as Field<unknown>);
    }
    if (built.output.availableInputs.height !== undefined) {
      fields.push(built.output.availableInputs.height as Field<unknown>);
    }
    for (const n of dirty) inputFieldsOf(built.output.styleInputs.get(n), fields);

    const { runtime, output } = built;
    for (const f of fields) {
      // `styleInputs` can hold an input Field no rule reads (e.g. a
      // flex-start container's main-END padding) — untracked, and a
      // change to it cannot move any layout field. Skip it.
      if (!runtime.isTracked(f)) continue;
      const live = output.grammar.get(f)!.compute(NEVER_READ);
      if (live !== runtime.evaluate(f)) runtime.markDirty(f);
    }
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
   * Reduce a set of changed Fields to the maximal moved-subtree roots.
   * Used by the structural fast-paths to determine which subtrees need
   * write-back after an incremental recompute.
   */
  private movedSubtreeRoots(changed: Iterable<Field<unknown>>): Node[] {
    const built = this.built!;
    const moved = new Set<Node>();
    for (const f of changed) {
      const n = built.owner.get(f);
      if (n !== undefined) moved.add(n);
    }
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

  /**
   * Write-back + round + scroll, scoped to the subtrees that moved.
   * A moved subtree's parent did not move, so its rounding is stable
   * and the subtree can be re-rounded in isolation; only that
   * parent's own scroll extent then needs a recompute.
   *
   * `extraScrollParents` are additional nodes whose scroll extents
   * must be recomputed — used by structural fast-paths to include
   * the surviving parent of a removed or reordered subtree.
   */
  private finishMoved(roots: Node[], extraScrollParents: Node[]): void {
    const { runtime, fields } = this.built!;
    for (const root of roots) {
      // Write the float layout for the whole moved subtree, so the
      // re-round below has float values throughout.
      const stack: Node[] = [root];
      while (stack.length > 0) {
        const n = stack.pop()!;
        // A `display: 'none'` node has no grammar fields — the
        // emitter skips it (v29). Skip it (and its subtree) here too,
        // mirroring `finishWhole`, which writes only `allFields`.
        const f = fields.get(n);
        if (f === undefined) continue;
        writeNode(n, runtime, f);
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
    for (const p of extraScrollParents) scrollParents.add(p);
    for (const p of scrollParents) recomputeScroll(p);
  }
}

/**
 * Write one node's evaluated float layout into `_layout`. The
 * `f.left` / `f.top` fields are the RENDERED positions: for an in-flow
 * `positionType: relative` node with `position*` edges set, the grammar
 * routes `f.left`/`f.top` through a wrapper that adds the offset (see
 * `applyRelativePositionOffset` in `flex-grammar.ts`). Sibling
 * chaining continues to use the underlying unshifted `left`/`top`
 * fields, so a relative offset does not displace this node's siblings.
 */
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

/** True iff `candidate` is `root` or a descendant of `root`. */
function isInSubtree(candidate: Node, root: Node): boolean {
  for (let n: Node | null = candidate; n !== null; n = n.getParent()) {
    if (n === root) return true;
  }
  return false;
}
