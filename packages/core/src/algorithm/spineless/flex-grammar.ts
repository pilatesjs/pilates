/**
 * Flexbox layout expressed as an attribute grammar.
 *
 * Current slice (v16b) covers:
 *
 *   - flex-direction: `row`, `column`, `row-reverse`, `column-reverse`
 *   - flex-grow / flex-shrink / flex-basis (v3-v4)
 *   - padding / margin / gap (v5)
 *   - justify-content + align-items / align-self (v6)
 *   - flex-wrap (v7) — single-line wrap and multi-line packing,
 *     each line independently distributed / justified / aligned
 *   - positionType: `'absolute'` (v8) — out-of-flow children
 *     positioned against the parent's OUTER box via `style.position`
 *     and `style.margin`. Width / height resolve from explicit
 *     style, from opposing edges (`left`+`right` or `top`+`bottom`),
 *     or fall back to 0. Absolute children are filtered out of every
 *     in-flow computation (flex distribution, justify leftover,
 *     wrap line packing).
 *   - align-content (v9) — for multi-line wrap containers, the cross-
 *     axis leftover is distributed among / around the lines per
 *     `flex-start` / `flex-end` / `center` / `space-between` /
 *     `space-around` / `stretch`
 *   - flex-wrap: `wrap-reverse` (v10) — the line stack is mirrored
 *     on the cross axis
 *   - flex-direction: `row-reverse` / `column-reverse` (v11) — the
 *     main axis runs from the container's main END; each in-flow
 *     child's main position is reflected across the inner-main box,
 *     mirroring the imperative `flipMainAxis`
 *   - min / max size clamping (v12) — every node's main size, cross
 *     size, and an absolute child's width / height are clamped to
 *     the node's own `[minWidth/Height, maxWidth/Height]`. v12a
 *     covered the single-shot sites (non-distributed main size,
 *     cross size, absolute children); v12b folds min/max into the
 *     flex-distribution freeze loop and the wrap line packer — an
 *     item whose proportional grow / shrink target breaches a clamp
 *     is frozen at its bound and its share redistributed, iterating
 *     to a fixpoint, exactly as the imperative `distributeGrow` /
 *     `distributeShrink`.
 *   - `'auto'` main size (v13) — a non-measured `'auto'` main-axis
 *     size resolves to 0 (mirroring `resolveHypotheticalMainSize`);
 *     the root's `'auto'` axis resolves from the caller-supplied
 *     `available` size, modelled as a root input Field so a terminal
 *     resize is incremental.
 *   - `'auto'` cross size + `align-items: stretch` (v14) — an
 *     `'auto'` cross-axis size is 0 under a non-stretch align, but
 *     `stretch` (the default) resizes it to fill the line's inner
 *     cross, mirroring the imperative `crossAlignItemsInLine`
 *     stretch branch.
 *   - `aspectRatio` (v15) — an `'auto'` axis whose perpendicular
 *     axis is an explicit number derives `width = height × ratio` /
 *     `height = width ÷ ratio`, mirroring `effectivePreferredSize`.
 *     A derived axis is definite (not content-sized) — so it is not
 *     stretched.
 *   - measure-func leaves (v16) — a childless node with a measure
 *     function resolves its `'auto'` axes by calling the measurer.
 *     v16a covers the MAIN axis (main free, cross constrained,
 *     mirroring `resolveHypotheticalMainSize`); v16b the CROSS axis
 *     (cross constrained `AtMost` the parent inner cross, main free
 *     with a hint, mirroring `naturalCrossSize`). A measured cross
 *     feeds the wrap line cross-size aggregation and the non-stretch
 *     cross size; `align-items: stretch` still overrides it.
 *
 * With v16 the grammar covers the full imperative `'auto'` /
 * measure / `aspectRatio` resolution: the Spineless engine is a
 * drop-in for `calculateLayout` on real content-sized trees.
 *
 * Fields emitted per node:
 *
 *   - `width`  — main-axis size when parent is `row`, cross-axis size
 *                when parent is `column`. Cross axis reads
 *                `style.width` verbatim. Main axis is the result of
 *                flex distribution when the parent has any child with
 *                grow > 0, shrink > 0, or numeric `flexBasis`;
 *                otherwise it equals the basis.
 *   - `height` — symmetric to `width`.
 *   - `left`   — position relative to parent. For row-parent children
 *                this is the main-axis cursor: `padLeft + myMarginLeft
 *                + sum_priors(marginLeft + width + marginRight) +
 *                i*gapColumn`. For column-parent children it's the
 *                cross-axis position: `padLeft + myMarginLeft`. Root
 *                is at 0.
 *   - `top`    — symmetric to `left`.
 *
 * @internal
 */

import { MeasureMode } from '../../measure-func.js';
import type { Node } from '../../node.js';
import type { Align, Justify } from '../../style.js';
import { isReverse, mainAxis } from '../axis.js';
import { type Field, type FieldRule, type Grammar, type ReadFn, field } from './grammar.js';

/**
 * Per-node input Fields for the style props the grammar reads. Each
 * is present only if the grammar actually reads that prop for the
 * node — every in-flow node has all three sizes; a container that
 * lays children out along an axis has the matching `gap*`; an
 * absolute child has `width` / `height` only when its size is
 * explicit.
 *
 * @internal
 */
export interface StyleInputs {
  width?: Field<number>;
  height?: Field<number>;
  flexBasis?: Field<number>;
  flexGrow?: Field<number>;
  flexShrink?: Field<number>;
  gapRow?: Field<number>;
  gapColumn?: Field<number>;
  /**
   * Min / max size clamps. `min*` default to 0; `max*` carry
   * `Infinity` when `style.max{Width,Height}` is `undefined` ("no
   * upper bound"), so a single `clampMinMax` covers both.
   */
  minWidth?: Field<number>;
  minHeight?: Field<number>;
  maxWidth?: Field<number>;
  maxHeight?: Field<number>;
  /**
   * Per-edge `padding` input Fields, indexed `[top, right, bottom,
   * left]`. Entries are present only for edges the grammar reads
   * (a container reads all four of its own padding edges).
   */
  padding?: Array<Field<number> | undefined>;
  /**
   * Per-edge `margin` input Fields, indexed `[top, right, bottom,
   * left]`. Present for every non-root in-flow node and every
   * absolute child (the grammar reads all four edges).
   */
  margin?: Array<Field<number> | undefined>;
  /**
   * Per-edge `position` input Fields, indexed `[top, right, bottom,
   * left]`. Present only for in-flow nodes with `positionType:
   * relative` that have at least one position edge read; absolute
   * children read `node.style.position` directly via the
   * non-grammar path. Entries fold to 0 when an edge is unset.
   */
  position?: Array<Field<number> | undefined>;
}

/**
 * Roots used by `buildFlexGrammar` to identify which (Node, name) pair
 * is the canonical entry point. The Spineless runtime / interpreter
 * starts evaluation from this set of fields and walks deps.
 *
 * @internal
 */
export interface FlexGrammarOutput {
  grammar: Grammar;
  /** Fields the caller typically wants computed on the root. */
  rootFields: {
    width: Field<number>;
    height: Field<number>;
    left: Field<number>;
    top: Field<number>;
  };
  /** All emitted fields, in pre-order. Useful for differential tests. */
  allFields: Array<{
    node: Node;
    width: Field<number>;
    height: Field<number>;
    left: Field<number>;
    top: Field<number>;
  }>;
  /**
   * Per-node input Fields for the style props the grammar models as
   * graph inputs — currently the SIZE props (`width` / `height` /
   * `flexBasis`), `gap` (`gapRow` / `gapColumn`), `padding` and
   * `margin` (per-edge). Each is a leaf field whose value is the live
   * `node.style` value; every layout field that reads one declares
   * the matching input as a dependency. To drive a precise
   * incremental relayout after a `setWidth` / `setHeight` /
   * `setFlexBasis` / `setFlexGrow` / `setFlexShrink` / `setGap` /
   * `setPadding` / `setMargin`, `markDirty` the input Field for the
   * mutated `(node, prop)` and call `recompute()` — propagation then
   * reaches exactly the affected layout fields, with no
   * `markAllDirty`.
   *
   * Every numeric style prop the grammar reads is now an input
   * field. What still needs a fresh `buildFlexGrammar()` is
   * STRUCTURAL mutation — flex-direction, flex-wrap on/off, the
   * justify / align category, `positionType`, and toggling a flex
   * weight or `flexBasis` across the zero / numeric boundary (which
   * flips whether the parent flex-distributes).
   */
  styleInputs: Map<Node, StyleInputs>;
  /**
   * Input Fields for the root's caller-supplied `available` size,
   * present only for an axis where the root's style is `'auto'`
   * (v13). `markDirty` one and `recompute()` to re-lay the tree
   * after a terminal resize.
   */
  availableInputs: { width?: Field<number>; height?: Field<number> };
  /**
   * Per-parent intermediate Fields for the phase-12 flex-distribution
   * grammar. Keyed by each flex-distributing single-line parent; value
   * is the `mainDistribution` Field emitted for that parent. Fragment
   * builders (append / remove / reorder) consult this to perform
   * precise rebinds without a full grammar rebuild.
   */
  mainDistributionByParent: Map<Node, Field<MainAxisDistribution>>;
}

/** Caller-supplied availability for an `'auto'`-sized root. */
export interface AvailableSize {
  width?: number;
  height?: number;
}

/**
 * Mutable accumulators + an optional boundary, threaded through the
 * grammar emitter. A field already present in `boundary` is treated
 * as pre-existing — the emitter references it as a dependency but
 * does not re-emit its rule into the accumulators. `buildFlexGrammar`
 * passes `boundary: null` (a whole-tree build); a subtree fragment
 * build passes the runtime's existing grammar, so only genuinely-new
 * fields land in `grammar` / `allFields` / `styleInputs`.
 *
 * @internal
 */
interface EmitContext {
  grammar: Grammar;
  allFields: FlexGrammarOutput['allFields'];
  styleInputs: Map<Node, StyleInputs>;
  boundary: Grammar | null;
  /**
   * Caller-supplied availability for an `'auto'`-sized root. The
   * emitter wires it into the root's `available:*` input Fields.
   * Subtree fragment builds omit it — fragments never re-emit the
   * root.
   */
  available: AvailableSize;
  /** The `available:*` input Fields, recorded as the emitter wires them. */
  availableInputs: { width?: Field<number>; height?: Field<number> };
  /** Phase-12: per-parent mainDistribution Fields, populated during emission. */
  mainDistributionByParent: Map<Node, Field<MainAxisDistribution>>;
}

/**
 * True iff `node` participates in its parent's flex flow — neither
 * out-of-flow (`positionType: 'absolute'`) nor hidden
 * (`display: 'none'`). A `display: 'none'` node is emitted no rules
 * at all and skipped everywhere an in-flow sibling is consulted,
 * mirroring the imperative algorithm — which `continue`s it in
 * `layoutChildren` and never writes its `_layout`.
 */
function isInFlow(node: Node): boolean {
  return node.style.positionType !== 'absolute' && node.style.display !== 'none';
}

/**
 * Build the topological per-node emitter — the `visit` recursion and
 * the input-field helpers it closes over — bound to one
 * `EmitContext`. `buildFlexGrammar` and the subtree fragment builders
 * share this, so a fragment emits rules byte-identical to a full
 * build.
 *
 * @internal
 */
function makeEmitter(
  ctx: EmitContext,
): (node: Node, parent: Node | null, indexInParent: number, priorSiblings: Node[]) => void {
  const { grammar, allFields, styleInputs, boundary, mainDistributionByParent } = ctx;

  // Register (once) the input Field for the root's caller-supplied
  // `available` size on one axis. Its `compute` reads `ctx.available`
  // live, so a caller that mutates that object and `markDirty`s the
  // field drives an incremental relayout after a terminal resize.
  function availableInput(root: Node, axis: 'width' | 'height'): Field<number> {
    const f = field<number>(root, `available:${axis}`);
    if (boundary?.has(f as Field<unknown>)) return f;
    if (!grammar.has(f as Field<unknown>)) {
      grammar.set(f as Field<unknown>, {
        deps: [],
        compute: () => ctx.available[axis] ?? 0,
      } satisfies FieldRule<number>);
      ctx.availableInputs[axis] = f;
    }
    return f;
  }

  // Register (once) the `measure:main` input Field for a measure-leaf
  // node's `'auto'` MAIN-axis size (v16a). Mirrors the imperative
  // `resolveHypotheticalMainSize` measure branch: the measurer is
  // called with the main axis FREE (`Undefined`) and the cross axis
  // constrained `AtMost` the cross constraint — the cross style size
  // when numeric, else the parent's inner cross. `mainProp` is the
  // node's main-axis prop; `parent` supplies the inner-cross fields.
  function measureMainInput(n: Node, mainProp: 'width' | 'height', parent: Node): Field<number> {
    const f = field<number>(n, 'measure:main');
    if (boundary?.has(f as Field<unknown>)) return f;
    if (!grammar.has(f as Field<unknown>)) {
      const fn = n.getMeasureFunc()!;
      const crossProp: 'width' | 'height' = mainProp === 'width' ? 'height' : 'width';
      const deps: Field<unknown>[] = [];
      let readCrossConstraint: (read: ReadFn) => number;
      if (typeof n.style[crossProp] === 'number') {
        const csInput = styleSizeInput(n, crossProp);
        deps.push(csInput as Field<unknown>);
        readCrossConstraint = (read) => read(csInput);
      } else {
        // Cross is `'auto'` — constrain to the parent's inner cross.
        const pdir = mainAxis(parent.style.flexDirection);
        const parentCrossF = field<number>(parent, crossProp);
        const padStartF = paddingInput(parent, crossStartEdge(pdir));
        const padEndF = paddingInput(parent, crossEndEdge(pdir));
        deps.push(
          parentCrossF as Field<unknown>,
          padStartF as Field<unknown>,
          padEndF as Field<unknown>,
        );
        readCrossConstraint = (read) =>
          Math.max(0, read(parentCrossF) - read(padStartF) - read(padEndF));
      }
      grammar.set(f as Field<unknown>, {
        deps,
        compute: (read) => {
          const cc = readCrossConstraint(read);
          // Main axis free; cross axis constrained AtMost.
          const r =
            mainProp === 'width'
              ? fn(0, MeasureMode.Undefined, cc, MeasureMode.AtMost)
              : fn(cc, MeasureMode.AtMost, 0, MeasureMode.Undefined);
          return mainProp === 'width' ? r.width : r.height;
        },
      } satisfies FieldRule<number>);
    }
    return f;
  }

  // Register (once) the `measure:cross` input Field for a
  // measure-leaf node's `'auto'` CROSS-axis size (v16b). Mirrors the
  // imperative `naturalCrossSize`: the measurer is called with the
  // cross axis constrained `AtMost` the parent's inner cross and the
  // main axis FREE (`Undefined`) with a hint — the main style size
  // when numeric, else the parent's inner cross. `crossProp` is the
  // node's cross-axis prop; `parent` supplies the inner-cross fields.
  function measureCrossInput(n: Node, crossProp: 'width' | 'height', parent: Node): Field<number> {
    const f = field<number>(n, 'measure:cross');
    if (boundary?.has(f as Field<unknown>)) return f;
    if (!grammar.has(f as Field<unknown>)) {
      const fn = n.getMeasureFunc()!;
      const mainProp: 'width' | 'height' = crossProp === 'width' ? 'height' : 'width';
      const pdir = mainAxis(parent.style.flexDirection);
      const parentCrossF = field<number>(parent, crossProp);
      const padStartF = paddingInput(parent, crossStartEdge(pdir));
      const padEndF = paddingInput(parent, crossEndEdge(pdir));
      const deps: Field<unknown>[] = [
        parentCrossF as Field<unknown>,
        padStartF as Field<unknown>,
        padEndF as Field<unknown>,
      ];
      // The main-axis hint is the main STYLE size when numeric (a
      // raw `preferredSize`, no aspectRatio), else the parent inner
      // cross — matching `naturalCrossSize`'s `mainHint`.
      let mainHintInput: Field<number> | null = null;
      if (typeof n.style[mainProp] === 'number') {
        mainHintInput = styleSizeInput(n, mainProp);
        deps.push(mainHintInput as Field<unknown>);
      }
      grammar.set(f as Field<unknown>, {
        deps,
        compute: (read) => {
          const innerCross = Math.max(0, read(parentCrossF) - read(padStartF) - read(padEndF));
          const mainHint = mainHintInput !== null ? read(mainHintInput) : innerCross;
          // Cross axis constrained AtMost the inner cross; main free.
          const r =
            crossProp === 'width'
              ? fn(innerCross, MeasureMode.AtMost, mainHint, MeasureMode.Undefined)
              : fn(mainHint, MeasureMode.Undefined, innerCross, MeasureMode.AtMost);
          return crossProp === 'width' ? r.width : r.height;
        },
      } satisfies FieldRule<number>);
    }
    return f;
  }

  // Resolve the input Field a node's main / cross size rule reads for
  // its preferred size on `axis`. Regimes (the auto/numeric split is
  // structural — a mutation across it needs a fresh build):
  //   - numeric `style[axis]` → the live `styleSizeInput`;
  //   - `'auto'` + `aspectRatio` + the perpendicular axis numeric →
  //     an `aspect:*` Field deriving the size from the other axis
  //     (v15), mirroring `effectivePreferredSize`;
  //   - `'auto'` MAIN axis of a measure-leaf → a `measure:main` Field
  //     (v16a), mirroring `resolveHypotheticalMainSize`;
  //   - `'auto'` CROSS axis of a measure-leaf → a `measure:cross`
  //     Field (v16b), mirroring `naturalCrossSize`;
  //   - `'auto'` on the root → the `available:*` input;
  //   - `'auto'` elsewhere → a constant `0` (v13 — matches the
  //     imperative fallback for a non-measured `'auto'` node).
  function preferredSizeInput(
    n: Node,
    axis: 'width' | 'height',
    role: 'main' | 'cross',
    parentOfN: Node | null,
  ): Field<number> {
    if (typeof n.style[axis] === 'number') return styleSizeInput(n, axis);
    if (aspectDerivable(n, axis)) {
      const other: 'width' | 'height' = axis === 'width' ? 'height' : 'width';
      const ratio = n.style.aspectRatio as number;
      const otherInput = styleSizeInput(n, other);
      const f = field<number>(n, `aspect:${axis}`);
      if (boundary?.has(f as Field<unknown>)) return f;
      if (!grammar.has(f as Field<unknown>)) {
        grammar.set(f as Field<unknown>, {
          deps: [otherInput as Field<unknown>],
          // width = height × ratio; height = width ÷ ratio.
          compute: (read) =>
            axis === 'width' ? read(otherInput) * ratio : read(otherInput) / ratio,
        } satisfies FieldRule<number>);
      }
      return f;
    }
    if (parentOfN !== null && isMeasureLeaf(n)) {
      return role === 'main'
        ? measureMainInput(n, axis, parentOfN)
        : measureCrossInput(n, axis, parentOfN);
    }
    if (parentOfN === null) return availableInput(n, axis);
    const f = field<number>(n, `preferred:${axis}`);
    if (boundary?.has(f as Field<unknown>)) return f;
    if (!grammar.has(f as Field<unknown>)) {
      grammar.set(f as Field<unknown>, {
        deps: [],
        compute: () => 0,
      } satisfies FieldRule<number>);
    }
    return f;
  }

  // The imperative `resolveRootAxisSize` clamps the root's size to
  // [min, max] for an explicit / `aspectRatio` / `available`-derived
  // axis — but its `'auto'` + no-`available` fallback returns a bare
  // `0`, *unclamped*. This predicate flags exactly that case so the
  // root size rule can skip the clamp and mirror the quirk (a root
  // `minWidth` must not inflate an unavailable axis).
  function rootAxisIsBareZero(n: Node, axis: 'width' | 'height'): boolean {
    return (
      typeof n.style[axis] !== 'number' &&
      !aspectDerivable(n, axis) &&
      ctx.available[axis] === undefined
    );
  }

  function styleInputEntry(n: Node): StyleInputs {
    let entry = styleInputs.get(n);
    if (entry === undefined) {
      entry = {};
      styleInputs.set(n, entry);
    }
    return entry;
  }

  // Register (once) the leaf input Field for a node's style SIZE
  // prop and return it. The field has no deps; its `compute` reads
  // `node.style` live. Layout fields that read a size declare the
  // returned field as a dependency, so a `markDirty` on it
  // propagates precisely through `recompute()`.
  function styleSizeInput(n: Node, prop: 'width' | 'height' | 'flexBasis'): Field<number> {
    const f = field<number>(n, `style:${prop}`);
    if (boundary?.has(f as Field<unknown>)) return f;
    if (!grammar.has(f as Field<unknown>)) {
      grammar.set(f as Field<unknown>, {
        deps: [],
        compute: () => n.style[prop] as number,
      } satisfies FieldRule<number>);
      styleInputEntry(n)[prop] = f;
    }
    return f;
  }

  // Register (once) the leaf input Field for a node's min / max
  // size clamp. `min*` reads `style.min{Width,Height}` (a number,
  // default 0); `max*` reads `style.max{Width,Height}` and folds the
  // `undefined` "no upper bound" sentinel to `Infinity`, so every
  // consumer can clamp with one unconditional `clampMinMax`.
  function minMaxInput(
    n: Node,
    prop: 'minWidth' | 'minHeight' | 'maxWidth' | 'maxHeight',
  ): Field<number> {
    const f = field<number>(n, `style:${prop}`);
    if (boundary?.has(f as Field<unknown>)) return f;
    if (!grammar.has(f as Field<unknown>)) {
      const isMax = prop === 'maxWidth' || prop === 'maxHeight';
      grammar.set(f as Field<unknown>, {
        deps: [],
        compute: () =>
          isMax ? (n.style[prop] ?? Number.POSITIVE_INFINITY) : (n.style[prop] as number),
      } satisfies FieldRule<number>);
      styleInputEntry(n)[prop] = f;
    }
    return f;
  }

  // Register (once) the leaf input Field for a flex weight
  // (`flexGrow` / `flexShrink`). Mutating a weight between two
  // POSITIVE values (or two zeros) is an in-regime change driven via
  // this field; crossing the zero boundary flips whether the parent
  // flex-distributes and so needs a fresh `buildFlexGrammar()`.
  function flexWeightInput(n: Node, prop: 'flexGrow' | 'flexShrink'): Field<number> {
    const f = field<number>(n, `style:${prop}`);
    if (boundary?.has(f as Field<unknown>)) return f;
    if (!grammar.has(f as Field<unknown>)) {
      grammar.set(f as Field<unknown>, {
        deps: [],
        compute: () => n.style[prop],
      } satisfies FieldRule<number>);
      styleInputEntry(n)[prop] = f;
    }
    return f;
  }

  // Register (once) the leaf input Field for a container's `gap`
  // along one output axis (`gapRow` separates column-stacked items,
  // `gapColumn` separates row-stacked items).
  function gapInput(n: Node, axis: 'row' | 'column'): Field<number> {
    const prop = axis === 'row' ? 'gapRow' : 'gapColumn';
    const f = field<number>(n, `style:${prop}`);
    if (boundary?.has(f as Field<unknown>)) return f;
    if (!grammar.has(f as Field<unknown>)) {
      grammar.set(f as Field<unknown>, {
        deps: [],
        compute: () => n.style[prop],
      } satisfies FieldRule<number>);
      styleInputEntry(n)[prop] = f;
    }
    return f;
  }

  // Register (once) the leaf input Field for one `padding` edge of a
  // container (`edge` is a [top,right,bottom,left] index). Defaults
  // to 0 when that edge is unset.
  function paddingInput(n: Node, edge: number): Field<number> {
    const f = field<number>(n, `style:padding:${edge}`);
    if (boundary?.has(f as Field<unknown>)) return f;
    if (!grammar.has(f as Field<unknown>)) {
      grammar.set(f as Field<unknown>, {
        deps: [],
        compute: () => n.style.padding[edge] ?? 0,
      } satisfies FieldRule<number>);
      const entry = styleInputEntry(n);
      if (entry.padding === undefined) entry.padding = [];
      entry.padding[edge] = f;
    }
    return f;
  }

  // Register (once) the leaf input Field for one `margin` edge of a
  // node (`edge` is a [top,right,bottom,left] index). Defaults to 0
  // when that edge is unset.
  function marginInput(n: Node, edge: number): Field<number> {
    const f = field<number>(n, `style:margin:${edge}`);
    if (boundary?.has(f as Field<unknown>)) return f;
    if (!grammar.has(f as Field<unknown>)) {
      grammar.set(f as Field<unknown>, {
        deps: [],
        compute: () => n.style.margin[edge] ?? 0,
      } satisfies FieldRule<number>);
      const entry = styleInputEntry(n);
      if (entry.margin === undefined) entry.margin = [];
      entry.margin[edge] = f;
    }
    return f;
  }

  // Register (once) the leaf input Field for one `position` edge of a
  // node (`edge` is a [top, right, bottom, left] index). Defaults to 0
  // when that edge is unset. Used only for in-flow relative nodes; the
  // absolute-positioning path reads `node.style.position` directly.
  function positionInput(n: Node, edge: number): Field<number> {
    const f = field<number>(n, `style:position:${edge}`);
    if (boundary?.has(f as Field<unknown>)) return f;
    if (!grammar.has(f as Field<unknown>)) {
      grammar.set(f as Field<unknown>, {
        deps: [],
        compute: () => n.style.position[edge] ?? 0,
      } satisfies FieldRule<number>);
      const entry = styleInputEntry(n);
      if (entry.position === undefined) entry.position = [];
      entry.position[edge] = f;
    }
    return f;
  }

  // ─── Phase 17: fold default-valued inputs ─────────────────────────────
  //
  // A grammar input field that is at its DEFAULT value contributes a
  // constant to every consuming rule. Emitting a Field for it creates
  // unnecessary structural cost — the only reason to have a Field is so
  // a future mutation has something to dirty. When the property IS at
  // default we skip the Field entirely and inline the constant. If the
  // property is later mutated, nodeSig's fold-predicate bits (Task 1)
  // change → the classifier triggers a full rebuild → the grammar is
  // re-emitted with the property NOT folded.

  /** A grammar input that is either a tracked Field or a folded constant. */
  type FoldedInput =
    | { readonly kind: 'field'; readonly field: Field<number> }
    | { readonly kind: 'const'; readonly value: number };

  /** Fold `minWidth`/`minHeight` (default 0) or `maxWidth`/`maxHeight`
   *  (default `undefined` → ∞). Returns a constant when at default;
   *  emits a leaf Field (via `minMaxInput`) otherwise. */
  function foldMinMax(
    n: Node,
    prop: 'minWidth' | 'minHeight' | 'maxWidth' | 'maxHeight',
  ): FoldedInput {
    const isMax = prop === 'maxWidth' || prop === 'maxHeight';
    const raw = n.style[prop];
    // Default sentinels MUST match nodeSig exactly (layout.ts):
    //   minWidth/minHeight default === 0
    //   maxWidth/maxHeight default === undefined
    if (isMax ? raw === undefined : raw === 0) {
      return { kind: 'const', value: isMax ? Number.POSITIVE_INFINITY : 0 };
    }
    return { kind: 'field', field: minMaxInput(n, prop) };
  }

  /** Fold one margin `edge` (default 0). Returns a constant when margin
   *  is 0; emits a leaf Field (via `marginInput`) otherwise. */
  function foldMargin(n: Node, edge: number): FoldedInput {
    // Default sentinel MUST match nodeSig exactly (layout.ts):
    //   margin[edge] default === 0
    if ((n.style.margin[edge] ?? 0) === 0) return { kind: 'const', value: 0 };
    return { kind: 'field', field: marginInput(n, edge) };
  }

  /** Read a FoldedInput inside a compute callback. */
  function readFolded(fi: FoldedInput, read: (f: Field<number>) => number): number {
    return fi.kind === 'field' ? read(fi.field) : fi.value;
  }

  /** Collect only the Field entries from a FoldedInput list. */
  function foldedDeps(fis: FoldedInput[]): Field<unknown>[] {
    const deps: Field<unknown>[] = [];
    for (const fi of fis) {
      if (fi.kind === 'field') deps.push(fi.field as Field<unknown>);
    }
    return deps;
  }

  // ──────────────────────────────────────────────────────────────────────

  function visit(
    node: Node,
    parent: Node | null,
    indexInParent: number,
    priorSiblings: Node[],
  ): void {
    const width = field<number>(node, 'width');
    const height = field<number>(node, 'height');
    const left = field<number>(node, 'left');
    const top = field<number>(node, 'top');

    // All four flex-direction values are supported (v11): the base
    // axis (`row` / `column`) drives field assignment; reverse
    // (`row-reverse` / `column-reverse`) flips child main positions.
    // Absolute children short-circuit the in-flow flex pipeline:
    // they're positioned independently against the parent's OUTER
    // box (no padding subtraction) using their own `style.position`
    // and `style.margin`. Their width / height can be `'auto'`, with
    // size derived from opposing edges or falling back to 0 — so the
    // in-flow "explicit numeric size" precondition is relaxed here.
    if (parent !== null && node.style.positionType === 'absolute') {
      emitAbsoluteRules(
        grammar,
        styleSizeInput,
        marginInput,
        minMaxInput,
        parent,
        node,
        width,
        height,
        left,
        top,
      );
      allFields.push({ node, width, height, left, top });
      const childCount = node.getChildCount();
      const childSiblings: Node[] = [];
      for (let i = 0; i < childCount; i++) {
        const child = node.getChild(i)!;
        // A `display: 'none'` child is laid out by nothing — emit it
        // no rules and do not recurse, mirroring the imperative
        // `layoutChildren` `continue`.
        if (child.style.display === 'none') continue;
        if (child.style.positionType === 'absolute') {
          visit(child, node, -1, []);
        } else {
          visit(child, node, childSiblings.length, [...childSiblings]);
          childSiblings.push(child);
        }
      }
      return;
    }

    // `'auto'` width / height are supported (v13): a non-measured
    // `'auto'` axis resolves to 0, the root's to its caller-supplied
    // `available`. See `preferredSizeInput`.

    // The parent's base axis decides which of {width, height} is the
    // main-axis size for THIS child (and which of {left, top} is the
    // main-axis position). Root is parent-less and treats both axes as
    // cross — sizes from style, positions at 0. `parentDirection` is
    // the base axis (`mainAxis` collapses `*-reverse` onto `row` /
    // `column`); `parentReverse` records whether the parent runs its
    // main axis backwards, applied as a post-hoc position flip.
    const parentDirection: 'row' | 'column' | null =
      parent === null ? null : mainAxis(parent.style.flexDirection);
    const parentReverse = parent !== null && isReverse(parent.style.flexDirection);
    const mainSizeField =
      parentDirection === 'column' ? (height as Field<unknown>) : (width as Field<unknown>);
    const crossSizeField =
      parentDirection === 'column' ? (width as Field<unknown>) : (height as Field<unknown>);
    const mainPosField =
      parentDirection === 'column' ? (top as Field<unknown>) : (left as Field<unknown>);
    const crossPosField =
      parentDirection === 'column' ? (left as Field<unknown>) : (top as Field<unknown>);
    const mainSizeName: 'width' | 'height' = parentDirection === 'column' ? 'height' : 'width';
    const mainPosName: 'top' | 'left' = parentDirection === 'column' ? 'top' : 'left';

    // Spacing inputs for this child. Both the parent's padding and
    // this child's own margin are modelled as leaf input Fields (see
    // `paddingInput` / `marginInput`) — one per [top,right,bottom,
    // left] edge — so each consumer declares the edge it reads as a
    // dependency and a `setPadding` / `setMargin` propagates
    // precisely through `recompute()`. The fields below are the
    // edges THIS child's layout reads: parent padding on the main /
    // cross axes, and this child's own main-start / cross-start /
    // cross-end margins. They are `null` for the root (which has no
    // parent and takes the constant path in every position rule).
    // (Structural mutations — flex-direction, flex-wrap on/off,
    // justify / align category — still need a fresh
    // `buildFlexGrammar()`.)
    const padMainStartF =
      parent === null ? null : paddingInput(parent, mainStartEdge(parentDirection!));
    const padMainEndF =
      parent === null ? null : paddingInput(parent, mainEndEdge(parentDirection!));
    const padCrossStartF =
      parent === null ? null : paddingInput(parent, crossStartEdge(parentDirection!));
    const padCrossEndF =
      parent === null ? null : paddingInput(parent, crossEndEdge(parentDirection!));
    // Phase 17: margin fields are resolved lazily at each rule site via
    // foldMargin() (fold-eligible rules) or marginInput() (always-needed).
    // Pre-compute edge indices once to avoid repeating edge-name calls.
    const mainStartEdgeIdx = parent === null ? -1 : mainStartEdge(parentDirection!);
    const crossStartEdgeIdx = parent === null ? -1 : crossStartEdge(parentDirection!);
    const crossEndEdgeIdx = parent === null ? -1 : crossEndEdge(parentDirection!);
    // Rules that always require the full tracked Field (e.g. stretch
    // crossSizeField, flex-end/center crossPos, reverse cumulative-sum)
    // use these pre-resolved fields so the idempotent marginInput is called
    // at most once per edge.
    // NOTE: calling marginInput here forces Field creation for these edges
    // regardless of whether they end up in a fold path. This is acceptable
    // because the rules that read them (stretch/flex-end/center/reverse) are
    // not fold-eligible — they always need tracked incremental propagation.
    // For nodes on fully fold-eligible paths (flex-start, no-stretch, no-
    // reverse), the Field is created if the code-path reaches it below;
    // the fold-eligible rules that invoke foldMargin() bypass this and
    // create no Field when margin is at default.
    let myMarginMainStartF: Field<number> | null = null;
    let myMarginCrossStartF: Field<number> | null = null;
    let myMarginCrossEndF: Field<number> | null = null;
    function getMarginMainStart(): Field<number> {
      if (myMarginMainStartF === null) myMarginMainStartF = marginInput(node, mainStartEdgeIdx);
      return myMarginMainStartF;
    }
    function getMarginCrossStart(): Field<number> {
      if (myMarginCrossStartF === null) myMarginCrossStartF = marginInput(node, crossStartEdgeIdx);
      return myMarginCrossStartF;
    }
    function getMarginCrossEnd(): Field<number> {
      if (myMarginCrossEndF === null) myMarginCrossEndF = marginInput(node, crossEndEdgeIdx);
      return myMarginCrossEndF;
    }

    // Alignment for this child: justify-content lives on the parent,
    // applies along the main axis once per line. align-items lives
    // on the parent; align-self overrides per child (with 'auto'
    // falling back to align-items).
    const justify: Justify = parent === null ? 'flex-start' : parent.style.justifyContent;
    const align: Align =
      parent === null
        ? 'auto'
        : node.style.alignSelf === 'auto'
          ? parent.style.alignItems
          : node.style.alignSelf;

    // Cross-axis size. For a numeric cross style, an `aspectRatio`-
    // derived cross, the `'auto'` root (sized from `available`), or a
    // content-`'auto'` cross under a non-stretch align, the size is
    // the resolved input clamped to the node's own [min, max]
    // (v12/v15). `align-items: stretch` (the default) instead
    // resizes a CONTENT-`'auto'` cross size to fill the line's inner
    // cross (v14) — mirroring the imperative `crossAlignItemsInLine`
    // stretch branch. An aspectRatio-derived cross is definite, so it
    // is not stretched. For a non-wrap parent the line cross IS the
    // parent's inner cross; a wrapping parent overrides
    // `crossSizeField` below with the per-line value.
    const crossKey: 'width' | 'height' = parentDirection === 'column' ? 'width' : 'height';
    const crossIsContentAuto =
      typeof node.style[crossKey] !== 'number' && !aspectDerivable(node, crossKey);
    const crossSizeInput = preferredSizeInput(node, crossKey, 'cross', parent);
    // Phase 17: fold min/max cross inputs when at default (0 / undefined→∞).
    const fMinCross = foldMinMax(node, crossKey === 'width' ? 'minWidth' : 'minHeight');
    const fMaxCross = foldMinMax(node, crossKey === 'width' ? 'maxWidth' : 'maxHeight');
    if (crossIsContentAuto && parent !== null && align === 'stretch') {
      // Stretch: resize to fill the parent's inner cross minus margins.
      // The margins cannot be folded here (they appear in a subtraction
      // expression), so use the always-needed field accessors.
      const mcs = getMarginCrossStart();
      const mce = getMarginCrossEnd();
      const parentCrossF = field<number>(parent, crossKey);
      grammar.set(crossSizeField, {
        deps: [
          parentCrossF as Field<unknown>,
          padCrossStartF as Field<unknown>,
          padCrossEndF as Field<unknown>,
          mcs as Field<unknown>,
          mce as Field<unknown>,
          ...foldedDeps([fMinCross, fMaxCross]),
        ],
        compute: (read) => {
          const innerCross = Math.max(
            0,
            read(parentCrossF) - read(padCrossStartF!) - read(padCrossEndF!),
          );
          const lineInner = innerCross - read(mcs) - read(mce);
          return clampMinMax(
            Math.max(0, lineInner),
            readFolded(fMinCross, read),
            readFolded(fMaxCross, read),
          );
        },
      } satisfies FieldRule<number>);
    } else if (parent === null && rootAxisIsBareZero(node, crossKey)) {
      // `'auto'` root, no `available` → bare 0, unclamped (see
      // `rootAxisIsBareZero`).
      grammar.set(crossSizeField, {
        deps: [crossSizeInput as Field<unknown>],
        compute: (read) => read(crossSizeInput),
      } satisfies FieldRule<number>);
    } else {
      // Phase 17: build deps only from non-default inputs.
      grammar.set(crossSizeField, {
        deps: [crossSizeInput as Field<unknown>, ...foldedDeps([fMinCross, fMaxCross])],
        compute: (read) =>
          clampMinMax(
            read(crossSizeInput),
            readFolded(fMinCross, read),
            readFolded(fMaxCross, read),
          ),
      } satisfies FieldRule<number>);
    }

    // When the parent has flex-wrap='wrap', all three position fields
    // (mainSize, mainPos, crossPos) flow through a single per-line
    // helper that packs the line set on demand. The helper depends on
    // the parent's main-axis size (line capacity), the parent's
    // cross-axis size (for the single-line-wrap case), and only on
    // the constant sibling style data — bases, margins, cross sizes
    // are all captured inline. The dep graph stays compact (parent
    // size fields only) at the cost of redoing the packing once per
    // child read.
    if (parent !== null && parent.style.flexWrap !== 'nowrap') {
      // Capture the in-flow siblings and this child's index among
      // them (both structural — a fresh build is needed if children
      // are inserted / removed). Every per-sibling value the line
      // packer reads — basis / main / cross size, grow / shrink
      // weights, margins — is a declared input-field dep, so a
      // size / flex / spacing mutation on any sibling propagates.
      const crossKeyName: 'width' | 'height' = parentDirection === 'column' ? 'width' : 'height';
      const mainStart = mainStartEdge(parentDirection!);
      const mainEnd = mainEndEdge(parentDirection!);
      const crossStart = crossStartEdge(parentDirection!);
      const crossEnd = crossEndEdge(parentDirection!);
      const wrapSibs: WrapSibInputs[] = [];
      let myIndex = -1;
      for (let i = 0; i < parent.getChildCount(); i++) {
        const sib = parent.getChild(i)!;
        if (!isInFlow(sib)) continue;
        if (sib === node) myIndex = wrapSibs.length;
        wrapSibs.push({
          node: sib,
          flexBasisInput: styleSizeInput(sib, 'flexBasis'),
          mainInput: preferredSizeInput(sib, mainSizeName, 'main', parent),
          crossInput: preferredSizeInput(sib, crossKeyName, 'cross', parent),
          growInput: flexWeightInput(sib, 'flexGrow'),
          shrinkInput: flexWeightInput(sib, 'flexShrink'),
          marginMainStartInput: marginInput(sib, mainStart),
          marginMainEndInput: marginInput(sib, mainEnd),
          marginCrossStartInput: marginInput(sib, crossStart),
          marginCrossEndInput: marginInput(sib, crossEnd),
          minInput: minMaxInput(sib, mainSizeName === 'width' ? 'minWidth' : 'minHeight'),
          maxInput: minMaxInput(sib, mainSizeName === 'width' ? 'maxWidth' : 'maxHeight'),
          minCrossInput: minMaxInput(sib, crossKeyName === 'width' ? 'minWidth' : 'minHeight'),
          maxCrossInput: minMaxInput(sib, crossKeyName === 'width' ? 'maxWidth' : 'maxHeight'),
          crossIsContentAuto:
            typeof sib.style[crossKeyName] !== 'number' && !aspectDerivable(sib, crossKeyName),
        });
      }
      const parentMainField = field<number>(parent, mainSizeName);
      const parentCrossField = field<number>(parent, crossKeyName);
      // Main-axis gap separates items along the stacking axis; the
      // cross-axis gap separates wrapped lines. Both are declared
      // deps so a `setGap` propagates here.
      const mainGapInput = gapInput(parent, parentDirection === 'column' ? 'row' : 'column');
      const crossGapInput = gapInput(parent, parentDirection === 'column' ? 'column' : 'row');
      const wrapDeps: Field<unknown>[] = [
        parentMainField as Field<unknown>,
        parentCrossField as Field<unknown>,
        mainGapInput as Field<unknown>,
        crossGapInput as Field<unknown>,
        padMainStartF as Field<unknown>,
        padMainEndF as Field<unknown>,
        padCrossStartF as Field<unknown>,
        padCrossEndF as Field<unknown>,
      ];
      for (const s of wrapSibs) {
        wrapDeps.push(
          s.flexBasisInput as Field<unknown>,
          s.mainInput as Field<unknown>,
          s.crossInput as Field<unknown>,
          s.growInput as Field<unknown>,
          s.shrinkInput as Field<unknown>,
          s.marginMainStartInput as Field<unknown>,
          s.marginMainEndInput as Field<unknown>,
          s.marginCrossStartInput as Field<unknown>,
          s.marginCrossEndInput as Field<unknown>,
          s.minInput as Field<unknown>,
          s.maxInput as Field<unknown>,
          s.minCrossInput as Field<unknown>,
          s.maxCrossInput as Field<unknown>,
        );
      }
      const evalWrapped = (read: ReadFn) => {
        const containerMain = read(parentMainField);
        const containerCross = read(parentCrossField);
        const padMainStart = read(padMainStartF!);
        const padCrossStart = read(padCrossStartF!);
        const innerMain = Math.max(0, containerMain - padMainStart - read(padMainEndF!));
        const innerCross = Math.max(0, containerCross - padCrossStart - read(padCrossEndF!));
        return evaluateWrappedChild(
          liveWrapSiblings(wrapSibs, parent, read),
          myIndex,
          innerMain,
          innerCross,
          read(mainGapInput),
          read(crossGapInput),
          justify,
          parent.style.alignContent,
          parent.style.flexWrap === 'wrap-reverse',
          padMainStart,
          padCrossStart,
        );
      };
      grammar.set(mainSizeField, {
        deps: wrapDeps,
        compute: (read) => evalWrapped(read).mainSize,
      } satisfies FieldRule<number>);
      grammar.set(mainPosField, {
        deps: wrapDeps,
        compute: (read) => evalWrapped(read).mainPos,
      } satisfies FieldRule<number>);
      if (parentReverse) {
        applyReverseMainPos(
          grammar,
          parent,
          mainPosField,
          mainSizeField,
          mainSizeName,
          padMainStartF!,
          padMainEndF!,
        );
      }
      grammar.set(crossPosField, {
        deps: wrapDeps,
        compute: (read) => evalWrapped(read).crossPos,
      } satisfies FieldRule<number>);
      // Override the shared cross-size rule: a wrapped child's cross
      // size depends on its own LINE's cross size (v14 stretch
      // resize), which only the line packer knows.
      grammar.set(crossSizeField, {
        deps: wrapDeps,
        compute: (read) => evalWrapped(read).crossSize,
      } satisfies FieldRule<number>);
      allFields.push({ node, width, height, left, top });
      // Relative-position offsets — wrap path. Same logic as the non-wrap
      // path below; parentDirection is in scope (computed before both paths
      // diverge) and applyReverseMainPos has already run above.
      if (parent !== null && parentDirection !== null) {
        const positionStyle = node.style.position;
        const hasAnyPositionEdge =
          positionStyle[0] !== undefined ||
          positionStyle[1] !== undefined ||
          positionStyle[2] !== undefined ||
          positionStyle[3] !== undefined;
        if (hasAnyPositionEdge) {
          const mainStartIdx = mainStartEdge(parentDirection);
          const mainEndIdx = mainEndEdge(parentDirection);
          const crossStartIdx = crossStartEdge(parentDirection);
          const crossEndIdx = crossEndEdge(parentDirection);
          applyRelativePositionOffset(
            grammar,
            node,
            mainPosField,
            crossPosField,
            positionInput(node, mainStartIdx),
            positionInput(node, mainEndIdx),
            positionInput(node, crossStartIdx),
            positionInput(node, crossEndIdx),
            mainStartIdx,
            mainEndIdx,
            crossStartIdx,
            crossEndIdx,
          );
        }
      }
      // Recurse into children. Absolute children are out-of-flow:
      // they must NOT advance the in-flow index or the priorSiblings
      // list (the same filtering the non-wrap path does below) —
      // otherwise an absolute child's margin / size leaks into a
      // later in-flow sibling's main position.
      const childCount = node.getChildCount();
      const inFlowSiblings: Node[] = [];
      for (let i = 0; i < childCount; i++) {
        const child = node.getChild(i)!;
        if (child.style.display === 'none') continue;
        if (child.style.positionType === 'absolute') {
          visit(child, node, -1, []);
        } else {
          visit(child, node, inFlowSiblings.length, [...inFlowSiblings]);
          inFlowSiblings.push(child);
        }
      }
      return;
    }

    // Main-axis size: depends on whether the parent flex-distributes
    // its children. A parent flex-distributes when ANY of its children
    // has grow > 0, shrink > 0, or a numeric flexBasis — i.e. anywhere
    // a child's main size could legitimately differ from its raw
    // style.{width|height}. Outside this case the main size is just
    // the resolved basis.
    if (parent === null || !parentNeedsFlexDistribution(parent)) {
      // No flex distribution: this node's main size is its resolved
      // basis, clamped to the node's own [min, max] (v12) — the
      // imperative `buildItem` clamps the hypothetical main size even
      // when no distribution follows. Declare deps on the node's own
      // flexBasis + main-size + min/max inputs so a size or clamp
      // mutation reaches this field precisely.
      //
      // The ROOT is special: `flexBasis` describes how a node behaves
      // as a flex CHILD, and the root is not one. `resolveRootAxisSize`
      // never consults it — so the root's main size is its preferred
      // size directly, no `flexBasis` short-circuit.
      const mainInput = preferredSizeInput(node, mainSizeName, 'main', parent);
      // Phase 17: fold min/max main inputs when at default (0 / undefined→∞).
      const fMinMain = foldMinMax(node, mainSizeName === 'width' ? 'minWidth' : 'minHeight');
      const fMaxMain = foldMinMax(node, mainSizeName === 'width' ? 'maxWidth' : 'maxHeight');
      if (parent === null) {
        if (rootAxisIsBareZero(node, mainSizeName)) {
          // `'auto'` root, no `available` → bare 0, unclamped.
          grammar.set(mainSizeField, {
            deps: [mainInput as Field<unknown>],
            compute: (read) => read(mainInput),
          } satisfies FieldRule<number>);
        } else {
          // Phase 17: deps only include non-default min/max.
          grammar.set(mainSizeField, {
            deps: [mainInput as Field<unknown>, ...foldedDeps([fMinMain, fMaxMain])],
            compute: (read) =>
              clampMinMax(read(mainInput), readFolded(fMinMain, read), readFolded(fMaxMain, read)),
          } satisfies FieldRule<number>);
        }
      } else {
        // Phase 17: flexBasis 'auto' is folded — when flexBasis === 'auto',
        // resolveBasisFromRead degenerates to read(mainInput). nodeSig already
        // captures typeof s.flexBasis (the 'auto' vs numeric boundary), so a
        // change from 'auto' to a numeric basis triggers a full rebuild.
        const flexBasisIsAuto = node.style.flexBasis === 'auto';
        if (flexBasisIsAuto) {
          // Degenerate form: basis auto → just use mainInput (no flexBasisInput field).
          grammar.set(mainSizeField, {
            deps: [mainInput as Field<unknown>, ...foldedDeps([fMinMain, fMaxMain])],
            compute: (read) =>
              clampMinMax(read(mainInput), readFolded(fMinMain, read), readFolded(fMaxMain, read)),
          } satisfies FieldRule<number>);
        } else {
          const flexBasisInput = styleSizeInput(node, 'flexBasis');
          grammar.set(mainSizeField, {
            deps: [
              flexBasisInput as Field<unknown>,
              mainInput as Field<unknown>,
              ...foldedDeps([fMinMain, fMaxMain]),
            ],
            compute: (read) =>
              clampMinMax(
                resolveBasisFromRead(read, flexBasisInput, mainInput),
                readFolded(fMinMain, read),
                readFolded(fMaxMain, read),
              ),
          } satisfies FieldRule<number>);
        }
      }
    } else {
      // Flex distribution. Capture the in-flow siblings + this
      // child's index (structural); declare every per-sibling value
      // the distribution reads — flexBasis / main size, grow /
      // shrink weights, main-axis margins — as input-field deps, so
      // a size / flex / spacing mutation on any sibling propagates
      // here. The size is derived from the parent's main-axis size
      // minus padding (the inner main).
      const flexMainStart = mainStartEdge(parentDirection!);
      const flexMainEnd = mainEndEdge(parentDirection!);
      const flexSibs: SizeInputs[] = [];
      let myIndex = -1;
      for (let i = 0; i < parent.getChildCount(); i++) {
        const sib = parent.getChild(i)!;
        if (!isInFlow(sib)) continue;
        if (sib === node) myIndex = flexSibs.length;
        flexSibs.push({
          node: sib,
          flexBasisInput: styleSizeInput(sib, 'flexBasis'),
          mainInput: preferredSizeInput(sib, mainSizeName, 'main', parent),
          growInput: flexWeightInput(sib, 'flexGrow'),
          shrinkInput: flexWeightInput(sib, 'flexShrink'),
          marginMainStartInput: marginInput(sib, flexMainStart),
          marginMainEndInput: marginInput(sib, flexMainEnd),
          minInput: minMaxInput(sib, mainSizeName === 'width' ? 'minWidth' : 'minHeight'),
          maxInput: minMaxInput(sib, mainSizeName === 'width' ? 'maxWidth' : 'maxHeight'),
        });
      }
      const parentMainField = field<number>(parent, mainSizeName);
      const mainGapInput = gapInput(parent, parentDirection === 'column' ? 'row' : 'column');

      // Phase 12 regime check: single-line + flex-distributing qualifies
      // for the O(N) intermediate `mainDistribution` Field. This gates
      // both the per-cell mainSize collapse (here) and the mainPos
      // collapse (Task 3); mainPos additionally narrows on
      // justify-content === 'flex-start'.
      const isPhase12DistributionRegime =
        parent.style.flexWrap === undefined || parent.style.flexWrap === 'nowrap';

      let parentMainDist: Field<MainAxisDistribution> | undefined;
      if (isPhase12DistributionRegime) {
        // Emit once per parent — memoize so subsequent children reuse
        // the same Field rather than emitting duplicate rules.
        parentMainDist = mainDistributionByParent.get(parent);
        if (parentMainDist === undefined) {
          parentMainDist = emitMainDistribution(
            grammar,
            parent,
            flexSibs,
            parentMainField,
            mainGapInput,
            padMainStartF!,
            padMainEndF!,
            marginInput,
            parentDirection!,
          );
          mainDistributionByParent.set(parent, parentMainDist);
        }
      }

      if (parentMainDist !== undefined) {
        // Phase 12: cell mainSize is a trivial index read into the
        // parent's pre-computed distribution array — O(1) dep edge
        // instead of O(N siblings).
        const myIndexCapture = myIndex;
        grammar.set(mainSizeField as Field<unknown>, {
          deps: [parentMainDist as Field<unknown>],
          compute: (read) => read(parentMainDist!).sizes[myIndexCapture]!,
        } satisfies FieldRule<number>);
      } else {
        // Non-qualifying regime (wrap): keep today's per-cell rule with
        // full sibling deps — distributeMainAxis called inline.
        const deps: Field<unknown>[] = [
          parentMainField as Field<unknown>,
          mainGapInput as Field<unknown>,
          padMainStartF as Field<unknown>,
          padMainEndF as Field<unknown>,
        ];
        for (const s of flexSibs) {
          deps.push(
            s.flexBasisInput as Field<unknown>,
            s.mainInput as Field<unknown>,
            s.growInput as Field<unknown>,
            s.shrinkInput as Field<unknown>,
            s.marginMainStartInput as Field<unknown>,
            s.marginMainEndInput as Field<unknown>,
            s.minInput as Field<unknown>,
            s.maxInput as Field<unknown>,
          );
        }
        grammar.set(mainSizeField, {
          deps,
          compute: (read) => {
            const innerMain = Math.max(
              0,
              read(parentMainField) - read(padMainStartF!) - read(padMainEndF!),
            );
            const siblings = liveFlexSiblings(flexSibs, read);
            return distributeMainAxis(siblings, innerMain, read(mainGapInput))[myIndex]!;
          },
        } satisfies FieldRule<number>);
      }
    }

    // Main-axis position. Two regimes:
    //   - Default (justify === 'flex-start'): a child's main position
    //     depends only on its prior siblings' main sizes — a constant
    //     offset (padding + own margins + sum of prior margins + gaps)
    //     plus the read of prior sizes. This is the v1-v5 dep
    //     pattern; no value redistribution along the main axis.
    //   - Any other justify value: leftover space is computed from
    //     ALL siblings' final main sizes, then distributed as a
    //     leading offset and/or extra gap. mainPos now depends on
    //     every sibling's main size and on the parent's main size.
    if (parent === null || indexInParent === 0) {
      if (parent === null) {
        // Root is parent-less — anchor at 0.
        grammar.set(mainPosField, {
          deps: [],
          compute: () => 0,
        } satisfies FieldRule<number>);
      } else if (justify === 'flex-start') {
        // Phase 12: read directly from the parent's mainDistribution if
        // it was emitted (parent flex-distributes + single-line).
        // Fallback to today's padding+margin rule when parent didn't qualify.
        const parentMainDist = mainDistributionByParent.get(parent);
        if (parentMainDist !== undefined) {
          const myIndexCapture = priorSiblings.length; // in-flow index
          grammar.set(mainPosField, {
            deps: [parentMainDist as Field<unknown>],
            compute: (read) => read(parentMainDist).positions[myIndexCapture]!,
          } satisfies FieldRule<number>);
        } else {
          // Phase 17: fold myMarginMainStart when at default (0).
          const fMyMarginMainStart = foldMargin(node, mainStartEdgeIdx);
          grammar.set(mainPosField, {
            deps: [padMainStartF as Field<unknown>, ...foldedDeps([fMyMarginMainStart])],
            compute: (read) => read(padMainStartF!) + readFolded(fMyMarginMainStart, read),
          } satisfies FieldRule<number>);
        }
      } else {
        // First child but parent uses non-default justify. Leading
        // offset still depends on leftover, which depends on every
        // sibling's main size.
        emitJustifiedMainPos(
          grammar,
          parent,
          mainPosField,
          mainSizeName,
          justify,
          indexInParent,
          parentDirection!,
          gapInput(parent, parentDirection === 'column' ? 'row' : 'column'),
          padMainStartF!,
          padMainEndF!,
          marginInput,
        );
      }
    } else if (justify === 'flex-start') {
      // Phase 12: read directly from the parent's mainDistribution if it
      // was emitted (parent flex-distributes + single-line). Fallback to
      // today's prior-siblings rule when the parent didn't qualify.
      const parentMainDist = mainDistributionByParent.get(parent);
      if (parentMainDist !== undefined) {
        const myIndexCapture = priorSiblings.length; // in-flow index
        grammar.set(mainPosField, {
          deps: [parentMainDist as Field<unknown>],
          compute: (read) => read(parentMainDist).positions[myIndexCapture]!,
        } satisfies FieldRule<number>);
      } else if (!parentReverse) {
        // Phase 16: linear recurrence. This child's main position is the
        // immediate predecessor's position + its box + one gap. O(1) deps
        // regardless of sibling count (was O(N) cumulative-sum). Unrolls
        // to the same total — see the Phase 16 design doc.
        // Note: only applies to forward directions; reverse directions use
        // the cumulative-sum below because applyReverseMainPos overwrites
        // each sibling's mainPosField with a reflected value, breaking the
        // chain (the predecessor's field holds its reflected position, not
        // the forward cursor this recurrence relies on).
        const prevSibling = priorSiblings[priorSiblings.length - 1]!;
        const prevMainPos = field<number>(prevSibling, mainPosName);
        const prevMainSize = field<number>(prevSibling, mainSizeName);
        const mainEndEdgeIdx = mainEndEdge(parentDirection!);
        // Phase 17: fold prevMarginEnd and myMarginMainStart when at default (0).
        const fPrevMarginEnd = foldMargin(prevSibling, mainEndEdgeIdx);
        const fMyMarginMainStart = foldMargin(node, mainStartEdgeIdx);
        const mainGapInput = gapInput(parent, parentDirection === 'column' ? 'row' : 'column');
        grammar.set(mainPosField, {
          deps: [
            prevMainPos as Field<unknown>,
            prevMainSize as Field<unknown>,
            ...foldedDeps([fPrevMarginEnd, fMyMarginMainStart]),
            mainGapInput as Field<unknown>,
          ],
          compute: (read) =>
            read(prevMainPos) +
            read(prevMainSize) +
            readFolded(fPrevMarginEnd, read) +
            readFolded(fMyMarginMainStart, read) +
            read(mainGapInput),
        } satisfies FieldRule<number>);
      } else {
        // Reverse direction: keep the cumulative-sum rule. The recurrence
        // cannot chain through the predecessor's mainPosField here because
        // applyReverseMainPos (applied per-sibling below) overwrites that
        // field with a reflected value — the predecessor's field no longer
        // carries the forward cursor the recurrence depends on.
        const priorMainSizes = priorSiblings.map((s) => field<number>(s, mainSizeName));
        const priorMargins = priorSiblings.map((s) => ({
          start: marginInput(s, mainStartEdge(parentDirection!)),
          end: marginInput(s, mainEndEdge(parentDirection!)),
        }));
        const mainGapInput = gapInput(parent, parentDirection === 'column' ? 'row' : 'column');
        // Reverse cumulative-sum: cannot fold margins — the expression
        // accumulates all sibling margins and this node's own marginMainStart.
        const myMMS = getMarginMainStart();
        grammar.set(mainPosField, {
          deps: [
            mainGapInput as Field<unknown>,
            padMainStartF as Field<unknown>,
            myMMS as Field<unknown>,
            ...(priorMainSizes as Field<unknown>[]),
            ...priorMargins.flatMap((m) => [m.start, m.end] as Field<unknown>[]),
          ],
          compute: (read) => {
            let sum = read(padMainStartF!) + read(myMMS) + indexInParent * read(mainGapInput);
            for (const m of priorMargins) sum += read(m.start) + read(m.end);
            for (const m of priorMainSizes) sum += read(m);
            return sum;
          },
        } satisfies FieldRule<number>);
      }
    } else {
      emitJustifiedMainPos(
        grammar,
        parent,
        mainPosField,
        mainSizeName,
        justify,
        indexInParent,
        parentDirection!,
        gapInput(parent, parentDirection === 'column' ? 'row' : 'column'),
        padMainStartF!,
        padMainEndF!,
        marginInput,
      );
    }

    // Reverse flex-direction (`row-reverse` / `column-reverse`): the
    // main axis runs from the container's main END. The position
    // rules above computed the forward-axis cursor; reflect it across
    // the inner-main box, exactly as the imperative `flipMainAxis`.
    if (parent !== null && parentReverse) {
      applyReverseMainPos(
        grammar,
        parent,
        mainPosField,
        mainSizeField,
        mainSizeName,
        padMainStartF!,
        padMainEndF!,
      );
    }

    // Cross-axis position. Default (flex-start, stretch with explicit
    // cross size, and any other value the imperative doesn't special-
    // case) is a constant offset. flex-end and center derive an offset
    // from the parent's cross-axis size, gaining a dep edge on it.
    if (parent === null || align === 'flex-end') {
      if (parent !== null && align === 'flex-end') {
        const parentCrossField = field<number>(
          parent,
          parentDirection === 'column' ? 'width' : 'height',
        );
        const mce = getMarginCrossEnd();
        grammar.set(crossPosField, {
          deps: [
            parentCrossField as Field<unknown>,
            crossSizeField,
            padCrossStartF as Field<unknown>,
            padCrossEndF as Field<unknown>,
            mce as Field<unknown>,
          ],
          // Anchor against the line's inner cross, which the
          // imperative `crossAlignItemsInLine` clamps to >= 0 — a
          // container whose cross padding exceeds its cross size has
          // a zero-width line, not a negative one.
          compute: (read) => {
            const padStart = read(padCrossStartF!);
            const innerCross = Math.max(0, read(parentCrossField) - padStart - read(padCrossEndF!));
            return padStart + innerCross - read(crossSizeField as Field<number>) - read(mce);
          },
        } satisfies FieldRule<number>);
      } else {
        // Root: no parent, no alignment to apply — anchor at 0.
        grammar.set(crossPosField, {
          deps: [],
          compute: () => 0,
        } satisfies FieldRule<number>);
      }
    } else if (align === 'center') {
      const parentCrossField = field<number>(
        parent,
        parentDirection === 'column' ? 'width' : 'height',
      );
      const mcs2 = getMarginCrossStart();
      const mce2 = getMarginCrossEnd();
      grammar.set(crossPosField, {
        deps: [
          parentCrossField as Field<unknown>,
          crossSizeField,
          padCrossStartF as Field<unknown>,
          padCrossEndF as Field<unknown>,
          mcs2 as Field<unknown>,
          mce2 as Field<unknown>,
        ],
        compute: (read) => {
          const padStart = read(padCrossStartF!);
          const innerCross = Math.max(0, read(parentCrossField) - padStart - read(padCrossEndF!));
          const marginStart = read(mcs2);
          const innerLine = innerCross - marginStart - read(mce2);
          const myCross = read(crossSizeField as Field<number>);
          return padStart + marginStart + Math.max(0, (innerLine - myCross) / 2);
        },
      } satisfies FieldRule<number>);
    } else {
      // flex-start, stretch (with explicit cross size — no resize),
      // and any other value (the imperative falls through to
      // flex-start) all share this offset: the parent's cross-start
      // padding plus this child's cross-start margin.
      // Phase 17: fold myMarginCrossStart when at default (0) — no Field
      // created, constant 0 inlined.
      const fMyMarginCrossStart = foldMargin(node, crossStartEdgeIdx);
      grammar.set(crossPosField, {
        deps: [padCrossStartF as Field<unknown>, ...foldedDeps([fMyMarginCrossStart])],
        compute: (read) => read(padCrossStartF!) + readFolded(fMyMarginCrossStart, read),
      } satisfies FieldRule<number>);
    }

    allFields.push({ node, width, height, left, top });

    // Relative-position offsets (matches classic engine's applyRelativeOffset
    // and CSS spec). Wraps mainPosField / crossPosField AFTER applyReverseMainPos
    // so the offset is applied to the final flow position. The hasAnyPositionEdge
    // short-circuit avoids creating 4 Fields per in-flow node when no offsets
    // are set — the common case.
    if (parent !== null && parentDirection !== null) {
      const positionStyle = node.style.position;
      const hasAnyPositionEdge =
        positionStyle[0] !== undefined ||
        positionStyle[1] !== undefined ||
        positionStyle[2] !== undefined ||
        positionStyle[3] !== undefined;
      if (hasAnyPositionEdge) {
        const mainStartIdx = mainStartEdge(parentDirection);
        const mainEndIdx = mainEndEdge(parentDirection);
        const crossStartIdx = crossStartEdge(parentDirection);
        const crossEndIdx = crossEndEdge(parentDirection);
        applyRelativePositionOffset(
          grammar,
          node,
          mainPosField,
          crossPosField,
          positionInput(node, mainStartIdx),
          positionInput(node, mainEndIdx),
          positionInput(node, crossStartIdx),
          positionInput(node, crossEndIdx),
          mainStartIdx,
          mainEndIdx,
          crossStartIdx,
          crossEndIdx,
        );
      }
    }

    // Recurse into children. Absolute children are out-of-flow: they
    // get visited (so their own subtree emits rules) but they don't
    // contribute to the in-flow sibling index or the priorSiblings
    // list that fuels positioning of subsequent in-flow siblings.
    const childCount = node.getChildCount();
    const inFlowSiblings: Node[] = [];
    for (let i = 0; i < childCount; i++) {
      const child = node.getChild(i)!;
      if (child.style.display === 'none') continue;
      if (child.style.positionType === 'absolute') {
        visit(child, node, -1, []);
      } else {
        visit(child, node, inFlowSiblings.length, [...inFlowSiblings]);
        inFlowSiblings.push(child);
      }
    }
  }

  return visit;
}

/**
 * Walk the tree rooted at `root` and emit a `Grammar` that computes
 * each node's `{width, height, left, top}`. See the module header
 * for the field rules. A whole-tree build — `boundary` is `null`.
 *
 * `'auto'` width / height are supported (v13): a non-measured
 * `'auto'` axis resolves to 0; the root's `'auto'` axis resolves
 * from `available` (matching `calculateLayout`'s availability args).
 *
 * @internal
 */
export function buildFlexGrammar(root: Node, available: AvailableSize = {}): FlexGrammarOutput {
  const grammar: Grammar = new Map();
  const allFields: FlexGrammarOutput['allFields'] = [];
  const styleInputs: Map<Node, StyleInputs> = new Map();
  const availableInputs: { width?: Field<number>; height?: Field<number> } = {};
  const mainDistributionByParent: Map<Node, Field<MainAxisDistribution>> = new Map();
  makeEmitter({
    grammar,
    allFields,
    styleInputs,
    boundary: null,
    available,
    availableInputs,
    mainDistributionByParent,
  })(root, null, 0, []);

  return {
    grammar,
    rootFields: {
      width: field<number>(root, 'width'),
      height: field<number>(root, 'height'),
      left: field<number>(root, 'left'),
      top: field<number>(root, 'top'),
    },
    allFields,
    styleInputs,
    availableInputs,
    mainDistributionByParent,
  };
}

/**
 * The patch inputs for a fast-pathed child append — see
 * `buildAppendFragment`.
 *
 * @internal
 */
export interface AppendFragment {
  /** Rules for the newly-added subtree's fields, for `graft`. */
  additions: Grammar;
  /** The new fields to start `SpinelessRuntime.graft`'s DFS from. */
  newRoots: Array<Field<unknown>>;
  /**
   * Existing fields whose rule the append rewrote, paired with the
   * new rule — for `SpinelessRuntime.rebindRule`. Empty for a
   * simple-regime append (`graft` alone suffices); non-empty when
   * the parent flex-distributes / justifies / wraps, where appending
   * a child also grows every existing sibling's dependency set.
   * Apply these AFTER `graft` (the new rules reference the grafted
   * fields), then call `recompute()`.
   */
  rebinds: Array<[Field<unknown>, FieldRule<unknown>]>;
  /**
   * A fresh full `FlexGrammarOutput` for the post-append tree. The
   * caller should adopt it for subsequent operations — its
   * `allFields` / `styleInputs` cover the new subtree (the runtime's
   * own grammar is patched in place by `graft` + `rebindRule`).
   */
  next: FlexGrammarOutput;
}

/** Merge two `StyleInputs` — `b`'s present fields win over `a`'s. */
function mergeStyleInputs(a: StyleInputs, b: StyleInputs): StyleInputs {
  const m: StyleInputs = { ...a };
  if (b.width !== undefined) m.width = b.width;
  if (b.height !== undefined) m.height = b.height;
  if (b.flexBasis !== undefined) m.flexBasis = b.flexBasis;
  if (b.gapRow !== undefined) m.gapRow = b.gapRow;
  if (b.gapColumn !== undefined) m.gapColumn = b.gapColumn;
  if (b.minWidth !== undefined) m.minWidth = b.minWidth;
  if (b.minHeight !== undefined) m.minHeight = b.minHeight;
  if (b.maxWidth !== undefined) m.maxWidth = b.maxWidth;
  if (b.maxHeight !== undefined) m.maxHeight = b.maxHeight;
  for (const k of ['padding', 'margin'] as const) {
    const bArr = b[k];
    if (bArr === undefined) continue;
    const arr = m[k] !== undefined ? [...(m[k] as Array<Field<number> | undefined>)] : [];
    for (let i = 0; i < bArr.length; i++) {
      if (bArr[i] !== undefined) arr[i] = bArr[i];
    }
    m[k] = arr;
  }
  return m;
}

/**
 * Merge the per-node `styleInputs` of a fragment (`extra`) into a
 * copy of `base`. A node present in both — the previous last child,
 * which gains a main-end margin input when it acquires a follower —
 * has its `StyleInputs` deep-merged rather than overwritten.
 */
function mergeStyleInputsMap(
  base: Map<Node, StyleInputs>,
  extra: Map<Node, StyleInputs>,
  mutateBase: boolean,
): Map<Node, StyleInputs> {
  // When mutateBase is true the caller owns `base` exclusively (it is
  // the previous grammar output, swapped out by the caller right after
  // this returns) — mutate it directly and skip the ~1,100-entry clone.
  const merged = mutateBase ? base : new Map(base);
  for (const [node, entry] of extra) {
    const existing = merged.get(node);
    merged.set(node, existing === undefined ? entry : mergeStyleInputs(existing, entry));
  }
  return merged;
}

/**
 * Fast-path a child INSERT for the Spineless runtime. If adding
 * `child` under `parent` can be absorbed without a fresh runtime,
 * return the patch inputs; return `null` when a full rebuild is
 * required — `child` is not a child of `parent`, or `parent` uses a
 * reverse `flex-direction` (supported by the grammar since v11, but
 * not by this structural fast-path — reflecting every sibling's
 * position is a whole-subtree rewrite).
 *
 * The new subtree's fields are always topological-tail additions
 * handled by `graft` (`additions` / `newRoots`). When `parent` is in
 * the "simple" regime (no flex distribution, default `flex-start`
 * justify, no wrap) AND `child` is its LAST child — or `child` is
 * absolute — that is the whole patch and `rebinds` is empty, and the
 * fragment is built in **O(subtree)**: `makeEmitter` emits just the
 * appended subtree against the runtime's grammar as a boundary, no
 * whole-tree rebuild. Otherwise the insert also rewrites existing
 * in-flow siblings' rules — a flex-distributing / justified /
 * wrapping parent reads every sibling, and a MID-LIST insert (v32)
 * shifts every later in-flow sibling's main position — so the
 * grammar is rebuilt O(tree) and `rebinds` carries those siblings'
 * rewritten rules.
 *
 * `next.grammar` is always `prev.grammar` — the runtime's own Map,
 * which `graft` / `rebindRule` patch in place; `next.allFields` /
 * `next.styleInputs` are refreshed lookup tables the caller adopts.
 *
 * @internal
 */
export function buildAppendFragment(
  prev: FlexGrammarOutput,
  root: Node,
  parent: Node,
  child: Node,
  available: AvailableSize = {},
): AppendFragment | null {
  // `child` must be a child of `parent`. Its index decides the path,
  // not whether the fragment is built: a last in-flow child can take
  // the O(subtree) graft; a mid-list in-flow insert shifts the later
  // siblings, so it takes the rebuild + rebind path below (v32).
  const count = parent.getChildCount();
  let childIndex = -1;
  for (let i = 0; i < count; i++) {
    if (parent.getChild(i) === child) {
      childIndex = i;
      break;
    }
  }
  if (childIndex === -1) return null;
  const isLast = childIndex === count - 1;

  // A `display: 'none'` appended child has no fields to graft — let
  // the rebuild path absorb it (a hidden node perturbs nothing, so
  // the rebuild is the simple correct route, not a fast-path miss).
  if (child.style.display === 'none') return null;

  // A reverse-direction parent is supported by the grammar (v11) but
  // not by this fast-path: the flip reflects every sibling, so fall
  // back to a full rebuild.
  const dir = parent.style.flexDirection;
  if (dir !== 'row' && dir !== 'column') return null;

  // An absolute child never perturbs in-flow siblings, so it is
  // always a pure tail graft. An in-flow child stays one only when it
  // is the LAST child of a simple-regime parent — a mid-list in-flow
  // insert shifts the later siblings and so takes the rebuild path.
  const simple =
    child.style.positionType === 'absolute' ||
    (isLast &&
      parent.style.flexWrap === 'nowrap' &&
      parent.style.justifyContent === 'flex-start' &&
      !parentNeedsFlexDistribution(parent));

  if (simple) {
    // O(subtree): emit just the appended subtree against the
    // runtime's grammar as a boundary, so the fragment's `grammar`
    // holds only genuinely-new fields. The expensive whole-tree walk
    // is skipped entirely.
    const ctx: EmitContext = {
      grammar: new Map(),
      allFields: [],
      styleInputs: new Map(),
      boundary: prev.grammar,
      available: {},
      availableInputs: {},
      mainDistributionByParent: new Map(),
    };
    const priors: Node[] = [];
    for (let i = 0; i < childIndex; i++) {
      const sib = parent.getChild(i)!;
      if (isInFlow(sib)) priors.push(sib);
    }
    makeEmitter(ctx)(child, parent, priors.length, priors);

    const newRoots: Array<Field<unknown>> = [];
    for (const e of ctx.allFields) {
      newRoots.push(
        e.width as Field<unknown>,
        e.height as Field<unknown>,
        e.left as Field<unknown>,
        e.top as Field<unknown>,
      );
    }
    const next: FlexGrammarOutput = {
      grammar: prev.grammar,
      rootFields: prev.rootFields,
      allFields: [...prev.allFields, ...ctx.allFields],
      styleInputs: mergeStyleInputsMap(prev.styleInputs, ctx.styleInputs, true),
      availableInputs: prev.availableInputs,
      mainDistributionByParent: prev.mainDistributionByParent,
    };
    return { additions: ctx.grammar, newRoots, rebinds: [], next };
  }

  // Non-simple: appending rewrites every surviving sibling's rules.
  // Rebuild the grammar O(tree) and diff it against `prev` for the
  // new fields; Field identity is stable across builds, so a key
  // absent from `prev.grammar` belongs to a newly-added node. The
  // rebuild needs the caller's `available` — the root's `'auto'`
  // size rule shape depends on it (`rootAxisIsBareZero`).
  const fresh = buildFlexGrammar(root, available);
  const additions: Grammar = new Map();
  for (const [f, rule] of fresh.grammar) {
    if (!prev.grammar.has(f)) additions.set(f, rule);
  }
  // `graft` integrates the DFS-closure of `newRoots`. A new node's
  // own layout fields don't reach every new field: a mid-list insert
  // leaves the inserted node's main-END margin read only by its
  // follower's (rebound, existing) rule — never by the node itself.
  // Starting the DFS from EVERY new field covers those orphans; the
  // DFS dedups, so the extra roots cost nothing.
  const newRoots: Array<Field<unknown>> = [...additions.keys()];
  const rebinds: Array<[Field<unknown>, FieldRule<unknown>]> = [];
  for (let i = 0; i < parent.getChildCount(); i++) {
    const sib = parent.getChild(i)!;
    if (sib === child || !isInFlow(sib)) continue;
    for (const name of ['width', 'height', 'left', 'top'] as const) {
      const f = field<number>(sib, name) as Field<unknown>;
      const rule = fresh.grammar.get(f);
      if (rule !== undefined) rebinds.push([f, rule]);
    }
  }
  // Phase 12: if the parent's mainDistribution field already existed in
  // prev (the parent was already flex-distributing pre-append) its
  // closure now covers different siblings — rebind it so recompute sees
  // the updated sibling list.
  const parentMainDistF = fresh.mainDistributionByParent.get(parent);
  if (parentMainDistF !== undefined && prev.grammar.has(parentMainDistF as Field<unknown>)) {
    const freshRule = fresh.grammar.get(parentMainDistF as Field<unknown>);
    if (freshRule !== undefined) rebinds.unshift([parentMainDistF as Field<unknown>, freshRule]);
  }
  const next: FlexGrammarOutput = {
    grammar: prev.grammar,
    rootFields: prev.rootFields,
    allFields: fresh.allFields,
    styleInputs: fresh.styleInputs,
    availableInputs: fresh.availableInputs,
    mainDistributionByParent: fresh.mainDistributionByParent,
  };
  return { additions, newRoots, rebinds, next };
}

/**
 * The patch inputs for a fast-pathed child removal — see
 * `buildRemoveFragment`.
 *
 * @internal
 */
export interface RemoveFragment {
  /**
   * Every field belonging to the removed subtree, for
   * `SpinelessRuntime.detach`. Apply this AFTER the `rebinds` — a
   * surviving sibling rebound off the removed child must drop its
   * dependency on the child's fields before they can be detached.
   */
  removed: Array<Field<unknown>>;
  /**
   * Existing fields whose rule the removal rewrote, paired with the
   * new rule — for `SpinelessRuntime.rebindRule`. Empty when removing
   * a last child from a simple-regime parent (`detach` alone
   * suffices); non-empty when the parent flex-distributes /
   * justifies / wraps, or the child is interior — where removing it
   * shrinks every surviving sibling's dependency set.
   */
  rebinds: Array<[Field<unknown>, FieldRule<unknown>]>;
  /**
   * A fresh full `FlexGrammarOutput` for the post-removal tree. The
   * caller adopts it for subsequent operations.
   */
  next: FlexGrammarOutput;
}

/**
 * Candidate grammar fields belonging to `node` — its four layout
 * fields, its `measure:*` fields (a measure leaf's `'auto'`-axis
 * measure inputs), and its style input fields recorded in
 * `styleInputs`. The caller filters to those actually in the grammar.
 *
 * Every NON-leaf per-node field MUST be listed — the four layout
 * fields, `measure:main` / `measure:cross` (a measure leaf's
 * `'auto'`-axis inputs) and `aspect:width` / `aspect:height` (an
 * `aspectRatio` node's derived sizes). Unlike a leaf style input,
 * these carry dependencies, so `SpinelessRuntime.detach`'s orphan
 * cleanup (which only drops dependency-free leaves) cannot reclaim
 * them — they have to be in the removed set explicitly, or a removed
 * style input they read dangles. Leaf style inputs not listed here
 * are reclaimed by that orphan cleanup.
 */
function nodeFields(node: Node, styleInputs: Map<Node, StyleInputs>): Array<Field<unknown>> {
  const out: Array<Field<unknown>> = [
    field<number>(node, 'width') as Field<unknown>,
    field<number>(node, 'height') as Field<unknown>,
    field<number>(node, 'left') as Field<unknown>,
    field<number>(node, 'top') as Field<unknown>,
    field<number>(node, 'measure:main') as Field<unknown>,
    field<number>(node, 'measure:cross') as Field<unknown>,
    field<number>(node, 'aspect:width') as Field<unknown>,
    field<number>(node, 'aspect:height') as Field<unknown>,
    // Phase 12: the per-parent mainDistribution intermediate field is a
    // non-leaf that has deps (siblings' size/flex inputs) and may be read
    // by each child's width/height rule. It MUST be in the removed set so
    // detach() does not see dangling reverse-dep edges from child layout
    // fields back to it.
    field<MainAxisDistribution>(node, 'mainDistribution') as Field<unknown>,
  ];
  const si = styleInputs.get(node);
  if (si !== undefined) {
    for (const k of ['width', 'height', 'flexBasis', 'gapRow', 'gapColumn'] as const) {
      const f = si[k];
      if (f !== undefined) out.push(f as Field<unknown>);
    }
    for (const arr of [si.padding, si.margin]) {
      if (arr === undefined) continue;
      for (const f of arr) {
        if (f !== undefined) out.push(f as Field<unknown>);
      }
    }
  }
  return out;
}

/**
 * Fast-path a child REMOVAL for the Spineless runtime — the mirror
 * of `buildAppendFragment`. Call this **before** detaching `child`
 * from `parent`: the simple-regime check needs `child` still in
 * place. Returns the patch inputs, or `null` when a full rebuild is
 * required (`child` is not `parent`'s child, or `parent` uses a
 * reverse `flex-direction` — supported by the grammar since v11 but
 * not by this fast-path).
 *
 * In the "simple" regime (no flex distribution, default `flex-start`
 * justify, no wrap — or `child` is absolute) the patch is built in
 * **O(subtree)**: `removed` is collected directly from `prev` by
 * walking the removed subtree, with no whole-tree rebuild, and
 * `rebinds` is empty. `SpinelessRuntime.detach` then drops those
 * fields and auto-cleans any input field they orphaned (e.g. the new
 * last child's now-unread main-end margin). Otherwise the removal
 * shrinks every surviving in-flow sibling's dependency set, so the
 * grammar is rebuilt O(tree) and `rebinds` carries those siblings'
 * rewritten rules. The caller applies `rebindRule` for each rebind
 * FIRST (so survivors stop depending on the removed fields), then
 * `detach`, then `recompute()`.
 *
 * Does not mutate the tree. `next.grammar` is `prev.grammar` — the
 * runtime's own Map, patched in place by `detach` / `rebindRule`.
 *
 * @internal
 */
export function buildRemoveFragment(
  prev: FlexGrammarOutput,
  root: Node,
  parent: Node,
  child: Node,
  available: AvailableSize = {},
): RemoveFragment | null {
  // `child` must be a child of `parent`.
  let index = -1;
  for (let i = 0; i < parent.getChildCount(); i++) {
    if (parent.getChild(i) === child) {
      index = i;
      break;
    }
  }
  if (index === -1) return null;

  // A `display: 'none'` child had no fields to begin with — there is
  // nothing to detach; let the rebuild path absorb the removal.
  if (child.style.display === 'none') return null;

  // A reverse-direction parent is supported by the grammar (v11) but
  // not by this fast-path: the flip reflects every sibling, so fall
  // back to a full rebuild.
  const dir = parent.style.flexDirection;
  if (dir !== 'row' && dir !== 'column') return null;

  // Removing a last child from a simple-regime parent perturbs no
  // surviving sibling. `child` is still attached, so
  // `parentNeedsFlexDistribution` sees it: a parent flex-distributing
  // *because of* `child` is correctly non-simple.
  const isLast = index === parent.getChildCount() - 1;
  const simple =
    child.style.positionType === 'absolute' ||
    (isLast &&
      parent.style.flexWrap === 'nowrap' &&
      parent.style.justifyContent === 'flex-start' &&
      !parentNeedsFlexDistribution(parent));

  // Collect the removed subtree's nodes (`child` + descendants).
  const removedNodes = new Set<Node>();
  const stack: Node[] = [child];
  while (stack.length > 0) {
    const n = stack.pop()!;
    removedNodes.add(n);
    for (let i = 0; i < n.getChildCount(); i++) stack.push(n.getChild(i)!);
  }

  if (simple) {
    // O(subtree): the removed set is exactly the subtree's own
    // fields, gathered straight from `prev` — no grammar rebuild.
    // `detach` auto-cleans the input fields they orphan.
    const removed: Array<Field<unknown>> = [];
    for (const n of removedNodes) {
      for (const f of nodeFields(n, prev.styleInputs)) {
        if (prev.grammar.has(f)) removed.push(f);
      }
    }
    // Mutate prev.styleInputs and prev.mainDistributionByParent in place:
    // `prev` is the old grammar output, single-use — the caller swaps
    // built.output to the new fragment immediately after this returns.
    for (const n of removedNodes) {
      prev.styleInputs.delete(n);
      prev.mainDistributionByParent.delete(n);
    }
    const next: FlexGrammarOutput = {
      grammar: prev.grammar,
      rootFields: prev.rootFields,
      allFields: prev.allFields.filter((e) => !removedNodes.has(e.node)),
      styleInputs: prev.styleInputs,
      availableInputs: prev.availableInputs,
      mainDistributionByParent: prev.mainDistributionByParent,
    };
    return { removed, rebinds: [], next };
  }

  // Non-simple: the removal rewrites every surviving sibling's rules.
  // Rebuild the grammar O(tree) — detach `child` around the build,
  // then restore the tree — and diff `prev \ fresh` for `removed`.
  // The rebuild needs the caller's `available` (root size rule shape).
  parent.removeChild(child);
  const fresh = buildFlexGrammar(root, available);
  parent.insertChild(child, index);

  const removed: Array<Field<unknown>> = [];
  for (const f of prev.grammar.keys()) {
    if (!fresh.grammar.has(f)) removed.push(f);
  }
  const rebinds: Array<[Field<unknown>, FieldRule<unknown>]> = [];
  for (let i = 0; i < parent.getChildCount(); i++) {
    const sib = parent.getChild(i)!;
    if (sib === child || !isInFlow(sib)) continue;
    for (const name of ['width', 'height', 'left', 'top'] as const) {
      const f = field<number>(sib, name) as Field<unknown>;
      const rule = fresh.grammar.get(f);
      if (rule !== undefined) rebinds.push([f, rule]);
    }
  }
  // Phase 12: if the parent's mainDistribution field survived the
  // removal (it's still in fresh.grammar), its closure now covers
  // fewer siblings — rebind it so recompute sees the updated list.
  const parentMainDistFRem = fresh.mainDistributionByParent.get(parent);
  if (parentMainDistFRem !== undefined && prev.grammar.has(parentMainDistFRem as Field<unknown>)) {
    const freshRule = fresh.grammar.get(parentMainDistFRem as Field<unknown>);
    if (freshRule !== undefined) rebinds.unshift([parentMainDistFRem as Field<unknown>, freshRule]);
  }
  const next: FlexGrammarOutput = {
    grammar: prev.grammar,
    rootFields: prev.rootFields,
    allFields: fresh.allFields,
    styleInputs: fresh.styleInputs,
    availableInputs: fresh.availableInputs,
    mainDistributionByParent: fresh.mainDistributionByParent,
  };
  return { removed, rebinds, next };
}

/**
 * The patch inputs for a fast-pathed child reorder — see
 * `buildReorderFragment`.
 *
 * @internal
 */
export interface ReorderFragment {
  /**
   * Input fields the reorder newly needs — for `SpinelessRuntime.graft`.
   * A reorder adds no node, but it can give a node a follower (or
   * take one away), and a node's main-END margin is read only when it
   * has a follower. So a node that gained a follower contributes a
   * newly-read margin input.
   */
  additions: Grammar;
  /** The new fields to start `graft`'s DFS from (every addition). */
  newRoots: Array<Field<unknown>>;
  /**
   * Input fields the reorder no longer needs — for
   * `SpinelessRuntime.detach`. The mirror of `additions`: a node that
   * lost its follower (became the last child) no longer has its
   * main-end margin read.
   */
  removed: Array<Field<unknown>>;
  /**
   * Existing fields whose rule the reorder rewrote, paired with the
   * new rule — for `SpinelessRuntime.rebindRule`.
   */
  rebinds: Array<[Field<unknown>, FieldRule<unknown>]>;
  /** A fresh full `FlexGrammarOutput` for the reordered tree. */
  next: FlexGrammarOutput;
}

/**
 * Fast-path a child REORDER for the Spineless runtime — `parent`'s
 * children are a permutation of their former order (no node added or
 * removed). The grammar is rebuilt O(tree) and the patch applied to
 * the existing runtime without a fresh `init`.
 *
 * Reordering `parent`'s children can only change the rules of
 * `parent` itself (its `'auto'` / wrap content size now packs the
 * children in a new order) and of its in-flow children (their main
 * positions, and — under wrap — their line-dependent sizes), so the
 * rebind set is `parent` + its in-flow children's
 * `width / height / left / top`. Descendants and ancestors recompute
 * from the changed VALUES; their rules are untouched.
 *
 * A reorder also shifts the "has a follower" boundary, so a node's
 * main-end margin input can become newly read (`additions`) or
 * newly unread (`removed`) — the same diff `buildAppendFragment`'s
 * non-simple branch takes. The caller applies `graft` then
 * `rebindRule` then `detach`.
 *
 * `next.grammar` is `prev.grammar` — the runtime's own Map, patched
 * in place.
 *
 * @internal
 */
export function buildReorderFragment(
  prev: FlexGrammarOutput,
  root: Node,
  parent: Node,
  available: AvailableSize = {},
): ReorderFragment {
  const fresh = buildFlexGrammar(root, available);

  const additions: Grammar = new Map();
  for (const [f, rule] of fresh.grammar) {
    if (!prev.grammar.has(f)) additions.set(f, rule);
  }
  const removed: Array<Field<unknown>> = [];
  for (const f of prev.grammar.keys()) {
    if (!fresh.grammar.has(f)) removed.push(f);
  }

  const rebinds: Array<[Field<unknown>, FieldRule<unknown>]> = [];
  const touched: Node[] = [parent];
  for (let i = 0; i < parent.getChildCount(); i++) {
    const c = parent.getChild(i)!;
    if (isInFlow(c)) touched.push(c);
  }
  for (const n of touched) {
    for (const name of ['width', 'height', 'left', 'top'] as const) {
      const f = field<number>(n, name) as Field<unknown>;
      const rule = fresh.grammar.get(f);
      if (rule !== undefined) rebinds.push([f, rule]);
    }
  }
  // Phase 12: the parent's mainDistribution field captures flexSibs in
  // child-position order. A reorder changes that order, so rebind it
  // (prepend so it is rebound before any child width that reads it).
  const parentMainDistFReorder = fresh.mainDistributionByParent.get(parent);
  if (
    parentMainDistFReorder !== undefined &&
    prev.grammar.has(parentMainDistFReorder as Field<unknown>)
  ) {
    const freshRule = fresh.grammar.get(parentMainDistFReorder as Field<unknown>);
    if (freshRule !== undefined)
      rebinds.unshift([parentMainDistFReorder as Field<unknown>, freshRule]);
  }

  const next: FlexGrammarOutput = {
    grammar: prev.grammar,
    rootFields: prev.rootFields,
    allFields: fresh.allFields,
    styleInputs: fresh.styleInputs,
    availableInputs: fresh.availableInputs,
    mainDistributionByParent: fresh.mainDistributionByParent,
  };
  return { additions, newRoots: [...additions.keys()], removed, rebinds, next };
}

/**
 * A sibling's SIZE input fields, captured at build time. `mainInput`
 * is `style:width` or `style:height` (whichever is the main axis);
 * `flexBasisInput` is `style:flexBasis`.
 *
 * @internal
 */
interface SizeInputs {
  node: Node;
  flexBasisInput: Field<number>;
  mainInput: Field<number>;
  growInput: Field<number>;
  shrinkInput: Field<number>;
  marginMainStartInput: Field<number>;
  marginMainEndInput: Field<number>;
  /** Main-axis min / max clamp inputs (v12b — the freeze loop). */
  minInput: Field<number>;
  maxInput: Field<number>;
}

/**
 * A wrap sibling's input fields — `SizeInputs` plus the cross-axis
 * size, cross-axis margin and cross-axis min / max inputs the wrap
 * line packer needs.
 *
 * @internal
 */
interface WrapSibInputs extends SizeInputs {
  crossInput: Field<number>;
  marginCrossStartInput: Field<number>;
  marginCrossEndInput: Field<number>;
  minCrossInput: Field<number>;
  maxCrossInput: Field<number>;
  /**
   * The cross axis is content-`'auto'` (`'auto'` with no
   * `aspectRatio` derivation) — eligible for the stretch resize.
   */
  crossIsContentAuto: boolean;
}

/**
 * Resolve a node's main-axis basis from its style input fields:
 * numeric `flexBasis` wins over the main-axis size. Mirrors the
 * imperative `resolveHypotheticalMainSize`. Both inputs are declared
 * deps of the calling rule, so this reads only cached values.
 *
 * @internal
 */
function resolveBasisFromRead(
  read: ReadFn,
  flexBasisInput: Field<number>,
  mainInput: Field<number>,
): number {
  const basis = read(flexBasisInput as Field<unknown>);
  return typeof basis === 'number' ? basis : read(mainInput);
}

/**
 * Clamp `value` to `[min, max]`. `max` carries `Infinity` for "no
 * upper bound" (see `minMaxInput`). Mirrors the imperative
 * `clampSize`: the floor is applied before the cap, so when
 * `min > max` the cap wins — `clampMinMax(5, 10, 3) === 3`.
 *
 * @internal
 */
function clampMinMax(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * True iff `axis` resolves from `aspectRatio` (v15): the axis is
 * `'auto'`, an `aspectRatio` is set, and the perpendicular axis is
 * an explicit number — exactly the case where the imperative
 * `effectivePreferredSize` derives a concrete size for an otherwise
 * `'auto'` axis. When this holds the axis is NOT content-sized: it
 * has a definite preferred size, so (e.g.) `align-items: stretch`
 * does not resize it.
 *
 * @internal
 */
function aspectDerivable(node: Node, axis: 'width' | 'height'): boolean {
  if (typeof node.style[axis] === 'number') return false;
  if (node.style.aspectRatio === undefined) return false;
  const other: 'width' | 'height' = axis === 'width' ? 'height' : 'width';
  return typeof node.style[other] === 'number';
}

/**
 * True iff `node` is a measure-function leaf: a childless node with
 * a measure function. The imperative algorithm consults the measurer
 * for such a node's `'auto'` axes (`resolveHypotheticalMainSize` /
 * `naturalCrossSize`); a non-leaf or measure-less node does not.
 *
 * @internal
 */
function isMeasureLeaf(node: Node): boolean {
  return node.getChildCount() === 0 && node.getMeasureFunc() !== null;
}

/**
 * Per-sibling inputs to `distributeMainAxis`, resolved inside a
 * compute callback by `read`ing the sibling's declared input fields.
 *
 * @internal
 */
interface FlexSibling {
  basis: number;
  grow: number;
  shrink: number;
  marginStart: number;
  marginEnd: number;
  /** Main-axis clamp bounds; `max` carries `Infinity` when unset. */
  min: number;
  max: number;
}

/**
 * Build the flex-distribution inputs for a fixed in-flow sibling set.
 * Every value — basis, grow / shrink weights, main-axis margins — is
 * read from a declared input field via `read`, so the calling rule's
 * dep list fully covers them.
 *
 * @internal
 */
function liveFlexSiblings(sibs: readonly SizeInputs[], read: ReadFn): FlexSibling[] {
  return sibs.map((s) => ({
    basis: resolveBasisFromRead(read, s.flexBasisInput, s.mainInput),
    grow: read(s.growInput),
    shrink: read(s.shrinkInput),
    marginStart: read(s.marginMainStartInput),
    marginEnd: read(s.marginMainEndInput),
    min: read(s.minInput),
    max: read(s.maxInput),
  }));
}

/**
 * Build the `WrapSibling` set for a wrapping container's in-flow
 * children. Like `liveFlexSiblings` but also carries cross-axis size
 * (from the declared `crossInput` field) + margins and the resolved
 * align value, which the wrap line packer needs.
 *
 * @internal
 */
function liveWrapSiblings(
  sibs: readonly WrapSibInputs[],
  parent: Node,
  read: ReadFn,
): WrapSibling[] {
  return sibs.map((s) => {
    const alignSelf = s.node.style.alignSelf;
    const crossNatural = read(s.crossInput);
    return {
      basis: resolveBasisFromRead(read, s.flexBasisInput, s.mainInput),
      grow: read(s.growInput),
      shrink: read(s.shrinkInput),
      min: read(s.minInput),
      max: read(s.maxInput),
      mainMarginStart: read(s.marginMainStartInput),
      mainMarginEnd: read(s.marginMainEndInput),
      // Two cross sizes (v12b): the imperative computes a line's
      // cross size from each item's UNCLAMPED natural cross
      // (`computeLineCrossSizes` → `naturalCross`), but positions an
      // item within its line using the CLAMPED cross
      // (`crossAlignItemsInLine` → `clampSize(naturalCross)`). A
      // min/max clamp can therefore make an item overflow its line.
      crossSizeNatural: crossNatural,
      crossSize: clampMinMax(crossNatural, read(s.minCrossInput), read(s.maxCrossInput)),
      crossMarginStart: read(s.marginCrossStartInput),
      crossMarginEnd: read(s.marginCrossEndInput),
      crossIsContentAuto: s.crossIsContentAuto,
      crossMin: read(s.minCrossInput),
      crossMax: read(s.maxCrossInput),
      align: alignSelf === 'auto' ? parent.style.alignItems : alignSelf,
    };
  });
}

/**
 * Emit the parent-level main-axis distribution Field for a
 * flex-distributing parent. Returns the Field so the per-child
 * mainSize / mainPos rules can declare it as their dependency.
 *
 * `deps` is the SAME deps list today's per-cell mainSizeField
 * rule declares (parent main, gap, padding, plus each in-flow
 * sibling's eight flex-related inputs).
 */
function emitMainDistribution(
  grammar: Grammar,
  parent: Node,
  flexSibs: SizeInputs[],
  parentMainField: Field<number>,
  mainGapInput: Field<number>,
  padMainStartF: Field<number>,
  padMainEndF: Field<number>,
  marginInput: (n: Node, edge: number) => Field<number>,
  parentDirection: 'row' | 'column',
): Field<MainAxisDistribution> {
  const mainDistField = field<MainAxisDistribution>(parent, 'mainDistribution');
  const deps: Field<unknown>[] = [
    parentMainField as Field<unknown>,
    mainGapInput as Field<unknown>,
    padMainStartF as Field<unknown>,
    padMainEndF as Field<unknown>,
  ];
  for (const s of flexSibs) {
    deps.push(
      s.flexBasisInput as Field<unknown>,
      s.mainInput as Field<unknown>,
      s.growInput as Field<unknown>,
      s.shrinkInput as Field<unknown>,
      s.marginMainStartInput as Field<unknown>,
      s.marginMainEndInput as Field<unknown>,
      s.minInput as Field<unknown>,
      s.maxInput as Field<unknown>,
    );
  }
  const mainStartEdgeName = mainStartEdge(parentDirection);
  const mainEndEdgeName = mainEndEdge(parentDirection);
  grammar.set(mainDistField as Field<unknown>, {
    deps,
    compute: (read) => {
      const innerMain = Math.max(
        0,
        read(parentMainField) - read(padMainStartF) - read(padMainEndF),
      );
      const siblings = liveFlexSiblings(flexSibs, read);
      const sizes = distributeMainAxis(siblings, innerMain, read(mainGapInput));

      // Fold sizes + margins + gaps into a prefix-sum positions array.
      // positions[i] is the i-th in-flow child's main offset from the
      // parent's border-box origin (so it INCLUDES the parent's main-
      // start padding), matching what the existing flex-start mainPos
      // rule returns. Task 2 assigns this directly to the child's
      // mainPos Field.
      const positions = new Array<number>(sizes.length);
      const gap = read(mainGapInput);
      const startPad = read(padMainStartF);
      let cursor = startPad;
      for (let i = 0; i < sizes.length; i++) {
        const sib = flexSibs[i]!;
        const marginStart = read(marginInput(sib.node, mainStartEdgeName));
        const marginEnd = read(marginInput(sib.node, mainEndEdgeName));
        if (i > 0) cursor += gap;
        cursor += marginStart;
        positions[i] = cursor;
        cursor += sizes[i]! + marginEnd;
      }
      return { sizes, positions };
    },
  } satisfies FieldRule<MainAxisDistribution>);
  return mainDistField;
}

/**
 * Emit the main-position rule for a child when the parent's
 * `justify-content` is not the default `flex-start`. The leftover
 * along the main axis is `max(0, innerMain - usedMain)`, where
 * `usedMain` is the sum of post-distribution main sizes plus margins
 * plus inter-item gaps. The leftover is distributed as a leading
 * cursor offset and/or an extra gap between items (the CSS rule).
 *
 * Dep graph: every sibling's main size and the parent's main size.
 * This is broader than the default flex-start case (priors only) but
 * matches what CSS requires — change any sibling's size and every
 * item's position can move under space-* or center.
 *
 * Dep graph: every in-flow sibling's main size, main-axis margins,
 * the parent's main size, the main-axis `gap`, and the parent's
 * main-axis `padding` edges — all declared input / layout Fields, so
 * any of them changing re-runs this rule.
 *
 * @internal
 */
function emitJustifiedMainPos(
  grammar: Grammar,
  parent: Node,
  mainPosField: Field<unknown>,
  mainSizeName: 'width' | 'height',
  justify: Justify,
  indexInParent: number,
  direction: 'row' | 'column',
  gapField: Field<number>,
  padStartField: Field<number>,
  padEndField: Field<number>,
  marginInput: (n: Node, edge: number) => Field<number>,
): void {
  // In-flow siblings only — absolute and `display: 'none'` children
  // don't contribute to justify-content's leftover calculation.
  const inFlow: Node[] = [];
  for (let i = 0; i < parent.getChildCount(); i++) {
    const sib = parent.getChild(i)!;
    if (!isInFlow(sib)) continue;
    inFlow.push(sib);
  }
  const allSizes: Field<number>[] = inFlow.map((s) => field<number>(s, mainSizeName));
  const startEdge = mainStartEdge(direction);
  const endEdge = mainEndEdge(direction);
  const marginStarts = inFlow.map((s) => marginInput(s, startEdge));
  const marginEnds = inFlow.map((s) => marginInput(s, endEdge));
  const n = allSizes.length;
  const parentMainField = field<number>(parent, mainSizeName);
  grammar.set(mainPosField, {
    deps: [
      parentMainField as Field<unknown>,
      gapField as Field<unknown>,
      padStartField as Field<unknown>,
      padEndField as Field<unknown>,
      ...(allSizes as Field<unknown>[]),
      ...(marginStarts as Field<unknown>[]),
      ...(marginEnds as Field<unknown>[]),
    ],
    compute: (read) => {
      const padStart = read(padStartField);
      const gap = read(gapField);
      const innerMain = Math.max(0, read(parentMainField) - padStart - read(padEndField));
      let usedMain = 0;
      for (let i = 0; i < n; i++) {
        usedMain += read(allSizes[i]!) + read(marginStarts[i]!) + read(marginEnds[i]!);
      }
      if (n > 1) usedMain += (n - 1) * gap;
      const leftover = Math.max(0, innerMain - usedMain);
      let leadingOffset = 0;
      let extraGap = 0;
      switch (justify) {
        case 'flex-end':
          leadingOffset = leftover;
          break;
        case 'center':
          leadingOffset = leftover / 2;
          break;
        case 'space-between':
          if (n > 1) extraGap = leftover / (n - 1);
          break;
        case 'space-around': {
          const slot = leftover / n;
          leadingOffset = slot / 2;
          extraGap = slot;
          break;
        }
        case 'space-evenly': {
          const slot = leftover / (n + 1);
          leadingOffset = slot;
          extraGap = slot;
          break;
        }
      }
      // Cursor walks the line up to this child, mirroring the
      // imperative positionItemsInLine.
      let cursor = padStart + leadingOffset;
      for (let i = 0; i < indexInParent; i++) {
        cursor += read(marginStarts[i]!) + read(allSizes[i]!) + read(marginEnds[i]!);
        cursor += gap + extraGap;
      }
      cursor += read(marginStarts[indexInParent]!);
      return cursor;
    },
  } satisfies FieldRule<number>);
}

/**
 * Re-wrap a child's already-emitted main-position rule so a
 * reverse-direction parent (`row-reverse` / `column-reverse`) lays
 * the child out from the main-axis END.
 *
 * Mirrors the imperative `flipMainAxis`: with `innerPos` the child's
 * forward offset inside the parent's inner-main box, the reflected
 * position is `padStart + innerMain - innerPos - childMain`. The
 * forward rule is preserved and invoked for `innerPos`; this wrapper
 * only reflects its result, so every regime (flex-start, justified,
 * wrap) reverses uniformly.
 *
 * The deps become the union of the forward rule's deps and the three
 * fields the reflection adds — the parent's main size, both main-axis
 * padding edges, and the child's own main size.
 *
 * @internal
 */
function applyReverseMainPos(
  grammar: Grammar,
  parent: Node,
  mainPosField: Field<unknown>,
  mainSizeField: Field<unknown>,
  mainSizeName: 'width' | 'height',
  padMainStartF: Field<number>,
  padMainEndF: Field<number>,
): void {
  const forward = grammar.get(mainPosField) as FieldRule<number>;
  const parentMainField = field<number>(parent, mainSizeName);
  const deps = [...forward.deps];
  for (const d of [
    parentMainField as Field<unknown>,
    padMainStartF as Field<unknown>,
    padMainEndF as Field<unknown>,
    mainSizeField,
  ]) {
    if (!deps.includes(d)) deps.push(d);
  }
  grammar.set(mainPosField, {
    deps,
    compute: (read) => {
      const forwardPos = forward.compute(read);
      const padStart = read(padMainStartF);
      const innerMain = Math.max(0, read(parentMainField) - padStart - read(padMainEndF));
      const childMain = read(mainSizeField as Field<number>);
      const innerPos = forwardPos - padStart;
      return padStart + innerMain - innerPos - childMain;
    },
  } satisfies FieldRule<number>);
}

/**
 * Apply CSS relative-position offsets to an in-flow child's
 * `mainPosField` / `crossPosField` by wrapping their already-emitted
 * rules with an additive transform. Pattern mirrors
 * `applyReverseMainPos`.
 *
 * Tiebreak (matches CSS / Yoga 3.x and the classic engine's
 * `applyRelativeOffset`): when both opposing edges are set, the start
 * edge wins — `positionTop` over `positionBottom`, `positionLeft`
 * over `positionRight`. The tiebreak must read `node.style.position`
 * LIVE because the `positionInput` Field returns
 * `style.position[edge] ?? 0`, conflating "unset" with "set to 0".
 *
 * Must run AFTER any other rule that finalizes `mainPosField` /
 * `crossPosField` for this node (e.g. `applyReverseMainPos` for
 * row-reverse parents) so the offset is applied to the final flow
 * position.
 *
 * @internal
 */
function applyRelativePositionOffset(
  grammar: Grammar,
  node: Node,
  mainPosField: Field<unknown>,
  crossPosField: Field<unknown>,
  positionMainStartF: Field<number>,
  positionMainEndF: Field<number>,
  positionCrossStartF: Field<number>,
  positionCrossEndF: Field<number>,
  mainStartEdgeIdx: number,
  mainEndEdgeIdx: number,
  crossStartEdgeIdx: number,
  crossEndEdgeIdx: number,
): void {
  const pairs = [
    [mainPosField, positionMainStartF, positionMainEndF, mainStartEdgeIdx, mainEndEdgeIdx],
    [crossPosField, positionCrossStartF, positionCrossEndF, crossStartEdgeIdx, crossEndEdgeIdx],
  ] as const;
  for (const [posField, startF, endF, startEdge, endEdge] of pairs) {
    const forward = grammar.get(posField) as FieldRule<number>;
    const deps = [...forward.deps];
    for (const d of [startF as Field<unknown>, endF as Field<unknown>]) {
      if (!deps.includes(d)) deps.push(d);
    }
    grammar.set(posField, {
      deps,
      compute: (read) => {
        const base = forward.compute(read);
        if (node.style.position[startEdge] !== undefined) return base + read(startF);
        if (node.style.position[endEdge] !== undefined) return base - read(endF);
        return base;
      },
    } satisfies FieldRule<number>);
  }
}

/**
 * True iff a parent's children carry any flex property that lets a
 * child's main size differ from its raw `style.{width|height}`: a
 * positive grow weight, a positive shrink weight, or a numeric
 * `flexBasis`.
 */
function parentNeedsFlexDistribution(parent: Node): boolean {
  const count = parent.getChildCount();
  for (let i = 0; i < count; i++) {
    const c = parent.getChild(i)!;
    if (!isInFlow(c)) continue;
    const s = c.style;
    if (s.flexGrow > 0) return true;
    if (s.flexShrink > 0) return true;
    if (typeof s.flexBasis === 'number') return true;
  }
  return false;
}

/** The per-sibling shape `distributeMainAxis` consumes. */
interface DistributeSibling {
  basis: number;
  grow: number;
  shrink: number;
  marginStart: number;
  marginEnd: number;
  /** Main-axis clamp bounds; `max` carries `Infinity` when unset. */
  min: number;
  max: number;
}

/**
 * The materialised result of a flex-distributing parent's main-axis
 * pass — sizes plus folded positions. One per qualifying parent.
 * Cells index into this instead of redoing the distribution each.
 * @internal
 */
export interface MainAxisDistribution {
  readonly sizes: readonly number[];
  readonly positions: readonly number[];
}

/**
 * Distribute `budget` across siblings using CSS flex semantics with
 * min/max clamping (v12b). Returns each sibling's final main-axis
 * size in input order.
 *
 * `budget` is the parent's inner main size (containerMain minus
 * leading + trailing padding). Margins and gaps are accounted for via
 * the hypothetical sum: only the basis part of each sibling expands
 * (grow) or contracts (shrink); margins and gaps are fixed-width
 * spacers that consume budget but never resize.
 *
 * Each sibling's hypothetical size is its basis clamped to its own
 * `[min, max]` — the imperative `buildItem` clamps before packing /
 * distribution. The grow / shrink passes then run the CSS freeze
 * loop (`freezeLoopGrow` / `freezeLoopShrink`): an item whose
 * proportional target would breach a clamp is pinned ("frozen") at
 * its bound and its share is redistributed among the rest, iterating
 * to a fixpoint. Mirrors `distributeGrow` / `distributeShrink` in
 * `main-axis.ts`.
 *
 * @internal
 */
function distributeMainAxis(
  siblings: readonly DistributeSibling[],
  budget: number,
  gap: number,
): number[] {
  const n = siblings.length;
  // Hypothetical = basis clamped to the sibling's own [min, max].
  const hyp = siblings.map((s) => clampMinMax(s.basis, s.min, s.max));
  let hypotheticalMain = 0;
  for (let i = 0; i < n; i++) {
    hypotheticalMain += hyp[i]! + siblings[i]!.marginStart + siblings[i]!.marginEnd;
  }
  if (n > 1) hypotheticalMain += (n - 1) * gap;
  const slack = budget - hypotheticalMain;

  const final = hyp.slice();
  if (slack > 0) {
    freezeLoopGrow(siblings, hyp, final, slack);
  } else if (slack < 0) {
    freezeLoopShrink(siblings, hyp, final, -slack);
  }
  return final;
}

/**
 * The flex-grow freeze loop. `hyp` holds each sibling's clamped
 * hypothetical; `final` is seeded with `hyp` and mutated in place to
 * the post-distribution sizes. Items with `grow <= 0` never grow;
 * an item whose proportional target breaches its `[min, max]` is
 * frozen at the clamped bound and drops out of subsequent rounds.
 * Mirrors the imperative `distributeGrow`.
 */
function freezeLoopGrow(
  siblings: readonly DistributeSibling[],
  hyp: readonly number[],
  final: number[],
  slack: number,
): void {
  const n = siblings.length;
  const frozen: boolean[] = new Array(n).fill(false);
  for (let i = 0; i < n; i++) {
    if (siblings[i]!.grow <= 0) frozen[i] = true;
  }
  for (let iter = 0; iter < n + 1; iter++) {
    let totalGrow = 0;
    let frozenContribution = 0;
    for (let i = 0; i < n; i++) {
      if (frozen[i]) frozenContribution += final[i]! - hyp[i]!;
      else totalGrow += siblings[i]!.grow;
    }
    if (totalGrow <= 0) return;
    const remaining = slack - frozenContribution;
    if (remaining <= 0) return;
    let frozeAny = false;
    for (let i = 0; i < n; i++) {
      if (frozen[i]) continue;
      const s = siblings[i]!;
      const target = hyp[i]! + (remaining * s.grow) / totalGrow;
      const clamped = clampMinMax(target, s.min, s.max);
      final[i] = clamped;
      if (clamped !== target) {
        frozen[i] = true;
        frozeAny = true;
      }
    }
    if (!frozeAny) return;
  }
}

/**
 * The flex-shrink freeze loop — symmetric to `freezeLoopGrow`. The
 * shrink share is scaled by `shrink * hypothetical` (CSS weights
 * shrink by base size). Mirrors the imperative `distributeShrink`.
 */
function freezeLoopShrink(
  siblings: readonly DistributeSibling[],
  hyp: readonly number[],
  final: number[],
  overflow: number,
): void {
  const n = siblings.length;
  const frozen: boolean[] = new Array(n).fill(false);
  for (let i = 0; i < n; i++) {
    if (siblings[i]!.shrink <= 0) frozen[i] = true;
  }
  for (let iter = 0; iter < n + 1; iter++) {
    let totalScaled = 0;
    let frozenContribution = 0;
    for (let i = 0; i < n; i++) {
      if (frozen[i]) frozenContribution += hyp[i]! - final[i]!;
      else totalScaled += siblings[i]!.shrink * hyp[i]!;
    }
    if (totalScaled <= 0) return;
    const remaining = overflow - frozenContribution;
    if (remaining <= 0) return;
    let frozeAny = false;
    for (let i = 0; i < n; i++) {
      if (frozen[i]) continue;
      const s = siblings[i]!;
      const scaled = s.shrink * hyp[i]!;
      if (scaled <= 0) {
        frozen[i] = true;
        continue;
      }
      const reduction = (remaining * scaled) / totalScaled;
      const target = hyp[i]! - reduction;
      const clamped = clampMinMax(target, s.min, s.max);
      final[i] = clamped;
      if (clamped !== target) {
        frozen[i] = true;
        frozeAny = true;
      }
    }
    if (!frozeAny) return;
  }
}

// ─── axis-aware spacing readers ─────────────────────────────────────────
// Edge order in style boxes is [top, right, bottom, left]. Gap layout
// is keyed on the OUTPUT axis (the one items stack along), not the
// flex-direction name — `gapColumn` separates row-stacked items
// (column between columns), `gapRow` separates column-stacked items.

const TOP = 0;
const RIGHT = 1;
const BOTTOM = 2;
const LEFT = 3;

function mainStartEdge(direction: 'row' | 'column'): number {
  return direction === 'column' ? TOP : LEFT;
}

function mainEndEdge(direction: 'row' | 'column'): number {
  return direction === 'column' ? BOTTOM : RIGHT;
}

function crossStartEdge(direction: 'row' | 'column'): number {
  return direction === 'column' ? LEFT : TOP;
}

function crossEndEdge(direction: 'row' | 'column'): number {
  // Cross axis is perpendicular to the main axis; its end edge sits
  // opposite the cross start edge.
  return direction === 'column' ? RIGHT : BOTTOM;
}

// ─── absolute positioning ───────────────────────────────────────────────

/**
 * Emit the four field rules for an out-of-flow (`positionType ===
 * 'absolute'`) child. Mirrors the imperative `layoutAbsoluteChild`
 * in `main-axis.ts`:
 *
 *   - width: explicit `style.width` if numeric, else (if both LEFT
 *     and RIGHT edges are set) derived from `parent.width - left -
 *     right - margins`, else 0.
 *   - height: symmetric, using TOP / BOTTOM edges.
 *   - left: if LEFT edge set, `left + margin.left`; else if RIGHT
 *     edge set, `parent.width - width - right - margin.right`; else
 *     `margin.left`.
 *   - top: symmetric, using TOP / BOTTOM and `parent.height`.
 *
 * The parent's OUTER size is used (no padding subtraction) —
 * matches Yoga / RN semantics that Pilates follows. Width and height
 * are clamped to the child's own [min, max] in every branch (v12),
 * exactly as the imperative `layoutAbsoluteChild` — including the
 * `0` fallback, so e.g. a `minWidth` with no explicit width still
 * binds.
 *
 * @internal
 */
function emitAbsoluteRules(
  grammar: Grammar,
  styleSizeInput: (n: Node, prop: 'width' | 'height' | 'flexBasis') => Field<number>,
  marginInput: (n: Node, edge: number) => Field<number>,
  minMaxInput: (
    n: Node,
    prop: 'minWidth' | 'minHeight' | 'maxWidth' | 'maxHeight',
  ) => Field<number>,
  parent: Node,
  child: Node,
  width: Field<number>,
  height: Field<number>,
  left: Field<number>,
  top: Field<number>,
): void {
  const pos = child.style.position;
  const posTop = pos[TOP];
  const posRight = pos[RIGHT];
  const posBottom = pos[BOTTOM];
  const posLeft = pos[LEFT];
  // Margins are declared input-field deps so a `setMargin` on the
  // absolute child propagates precisely. The `position` edges stay
  // captured: their presence selects the branch (structural).
  const mTop = marginInput(child, TOP);
  const mRight = marginInput(child, RIGHT);
  const mBottom = marginInput(child, BOTTOM);
  const mLeft = marginInput(child, LEFT);
  const styleW = child.style.width;
  const styleH = child.style.height;
  const parentWField = field<number>(parent, 'width');
  const parentHField = field<number>(parent, 'height');
  // Min / max clamp inputs — declared deps so a `setMinWidth` … on
  // the absolute child propagates precisely.
  const minW = minMaxInput(child, 'minWidth');
  const maxW = minMaxInput(child, 'maxWidth');
  const minH = minMaxInput(child, 'minHeight');
  const maxH = minMaxInput(child, 'maxHeight');

  // Width. The explicit-width branch reads the child's `style:width`
  // input field, so a `setWidth` on the absolute child propagates
  // precisely through markDirty + recompute. Mutating the child from
  // explicit to 'auto' (or vice-versa) requires a fresh grammar build
  // since that crosses branch boundaries — out of scope here. Every
  // branch clamps to [minW, maxW], matching `layoutAbsoluteChild`.
  if (typeof styleW === 'number') {
    const wInput = styleSizeInput(child, 'width');
    grammar.set(width as Field<unknown>, {
      deps: [wInput as Field<unknown>, minW as Field<unknown>, maxW as Field<unknown>],
      compute: (read) => clampMinMax(read(wInput), read(minW), read(maxW)),
    } satisfies FieldRule<number>);
  } else if (posLeft !== undefined && posRight !== undefined) {
    grammar.set(width as Field<unknown>, {
      deps: [
        parentWField as Field<unknown>,
        mLeft as Field<unknown>,
        mRight as Field<unknown>,
        minW as Field<unknown>,
        maxW as Field<unknown>,
      ],
      compute: (read) =>
        clampMinMax(
          Math.max(0, read(parentWField) - posLeft - posRight - read(mLeft) - read(mRight)),
          read(minW),
          read(maxW),
        ),
    } satisfies FieldRule<number>);
  } else if (isMeasureLeaf(child)) {
    // `'auto'` width, no opposing edges: the measurer sizes it.
    // Mirrors `layoutAbsoluteChild` — call the measurer with the
    // parent's outer box `AtMost` on both axes and take `.width`.
    const measure = child.getMeasureFunc()!;
    grammar.set(width as Field<unknown>, {
      deps: [
        parentWField as Field<unknown>,
        parentHField as Field<unknown>,
        minW as Field<unknown>,
        maxW as Field<unknown>,
      ],
      compute: (read) =>
        clampMinMax(
          measure(read(parentWField), MeasureMode.AtMost, read(parentHField), MeasureMode.AtMost)
            .width,
          read(minW),
          read(maxW),
        ),
    } satisfies FieldRule<number>);
  } else {
    grammar.set(width as Field<unknown>, {
      deps: [minW as Field<unknown>, maxW as Field<unknown>],
      compute: (read) => clampMinMax(0, read(minW), read(maxW)),
    } satisfies FieldRule<number>);
  }

  // Height — symmetric to width.
  if (typeof styleH === 'number') {
    const hInput = styleSizeInput(child, 'height');
    grammar.set(height as Field<unknown>, {
      deps: [hInput as Field<unknown>, minH as Field<unknown>, maxH as Field<unknown>],
      compute: (read) => clampMinMax(read(hInput), read(minH), read(maxH)),
    } satisfies FieldRule<number>);
  } else if (posTop !== undefined && posBottom !== undefined) {
    grammar.set(height as Field<unknown>, {
      deps: [
        parentHField as Field<unknown>,
        mTop as Field<unknown>,
        mBottom as Field<unknown>,
        minH as Field<unknown>,
        maxH as Field<unknown>,
      ],
      compute: (read) =>
        clampMinMax(
          Math.max(0, read(parentHField) - posTop - posBottom - read(mTop) - read(mBottom)),
          read(minH),
          read(maxH),
        ),
    } satisfies FieldRule<number>);
  } else if (isMeasureLeaf(child)) {
    // `'auto'` height, no opposing edges: measure with the resolved
    // width `Exactly` and the parent's outer height `AtMost` — the
    // `layoutAbsoluteChild` height branch. The dep on `width` orders
    // this rule after the width rule above.
    const measure = child.getMeasureFunc()!;
    grammar.set(height as Field<unknown>, {
      deps: [
        width as Field<unknown>,
        parentHField as Field<unknown>,
        minH as Field<unknown>,
        maxH as Field<unknown>,
      ],
      compute: (read) =>
        clampMinMax(
          measure(read(width), MeasureMode.Exactly, read(parentHField), MeasureMode.AtMost).height,
          read(minH),
          read(maxH),
        ),
    } satisfies FieldRule<number>);
  } else {
    grammar.set(height as Field<unknown>, {
      deps: [minH as Field<unknown>, maxH as Field<unknown>],
      compute: (read) => clampMinMax(0, read(minH), read(maxH)),
    } satisfies FieldRule<number>);
  }

  // Left
  if (posLeft !== undefined) {
    grammar.set(left as Field<unknown>, {
      deps: [mLeft as Field<unknown>],
      compute: (read) => posLeft + read(mLeft),
    } satisfies FieldRule<number>);
  } else if (posRight !== undefined) {
    grammar.set(left as Field<unknown>, {
      deps: [parentWField as Field<unknown>, width as Field<unknown>, mRight as Field<unknown>],
      compute: (read) => read(parentWField) - read(width) - posRight - read(mRight),
    } satisfies FieldRule<number>);
  } else {
    grammar.set(left as Field<unknown>, {
      deps: [mLeft as Field<unknown>],
      compute: (read) => read(mLeft),
    } satisfies FieldRule<number>);
  }

  // Top
  if (posTop !== undefined) {
    grammar.set(top as Field<unknown>, {
      deps: [mTop as Field<unknown>],
      compute: (read) => posTop + read(mTop),
    } satisfies FieldRule<number>);
  } else if (posBottom !== undefined) {
    grammar.set(top as Field<unknown>, {
      deps: [parentHField as Field<unknown>, height as Field<unknown>, mBottom as Field<unknown>],
      compute: (read) => read(parentHField) - read(height) - posBottom - read(mBottom),
    } satisfies FieldRule<number>);
  } else {
    grammar.set(top as Field<unknown>, {
      deps: [mTop as Field<unknown>],
      compute: (read) => read(mTop),
    } satisfies FieldRule<number>);
  }
}

// ─── wrap-aware line layout ─────────────────────────────────────────────

interface WrapSibling {
  basis: number;
  grow: number;
  shrink: number;
  /** Main-axis clamp bounds; `max` carries `Infinity` when unset. */
  min: number;
  max: number;
  mainMarginStart: number;
  mainMarginEnd: number;
  /**
   * Unclamped cross style size — feeds the line cross-size
   * aggregation (`computeLineCrossSizes` uses `naturalCross`).
   */
  crossSizeNatural: number;
  /**
   * Cross size clamped to the cross-axis [min, max] — feeds
   * within-line cross-alignment (the imperative positions against
   * `clampSize(naturalCross)`).
   */
  crossSize: number;
  crossMarginStart: number;
  crossMarginEnd: number;
  /**
   * The cross axis is content-`'auto'` (`'auto'` with no
   * `aspectRatio` derivation) — eligible for the stretch resize.
   */
  crossIsContentAuto: boolean;
  /** Cross-axis clamp bounds; `crossMax` carries `Infinity` when unset. */
  crossMin: number;
  crossMax: number;
  align: Align;
}

/**
 * Pack `siblings` greedily into lines along the main axis, run flex
 * distribution per line, compute each line's cross size and start,
 * then resolve the indicated child's `{mainSize, mainPos, crossPos}`.
 *
 * Mirrors the imperative `packIntoLines` → `distributeFlexInLine` →
 * `computeLineCrossSizes` → `positionLinesOnCross` (the `alignContent`
 * line distribution) → `positionItemsInLine` → `crossAlignItemsInLine`
 * chain. The single-line case (one packed line) collapses crossSize
 * to `innerCross` and crossPos of the line to 0, matching the
 * imperative's `singleLineMode` branch.
 *
 * Called once per child per layout pass; the per-child callbacks pick
 * out their own value from the returned struct. Total work is O(N²)
 * for an N-child wrapped container — acceptable for v7; later
 * Spineless tiers can extract shared per-line fields.
 *
 * @internal
 */
function evaluateWrappedChild(
  siblings: readonly WrapSibling[],
  childIndex: number,
  innerMain: number,
  innerCross: number,
  mainGap: number,
  crossGap: number,
  justify: Justify,
  alignContent: Align,
  reverse: boolean,
  padMainStart: number,
  padCrossStart: number,
): { mainSize: number; mainPos: number; crossPos: number; crossSize: number } {
  const n = siblings.length;

  // Pack greedily, recording per-line start index and count.
  const lineFirst: number[] = [];
  const lineCount: number[] = [];
  {
    let start = 0;
    let acc = 0;
    for (let i = 0; i < n; i++) {
      const s = siblings[i]!;
      // Pack on the clamped hypothetical (v12b) — the imperative
      // `packIntoLines` keys on `item.hypothetical`, not raw basis.
      const itemMain = clampMinMax(s.basis, s.min, s.max) + s.mainMarginStart + s.mainMarginEnd;
      const inLine = i > start;
      const wouldUse = acc + (inLine ? mainGap : 0) + itemMain;
      if (inLine && wouldUse > innerMain) {
        lineFirst.push(start);
        lineCount.push(i - start);
        start = i;
        acc = itemMain;
      } else {
        if (inLine) acc += mainGap;
        acc += itemMain;
      }
    }
    if (start < n) {
      lineFirst.push(start);
      lineCount.push(n - start);
    }
  }
  const numLines = lineFirst.length;
  const isMultiline = numLines > 1;

  // Per-line distribution. WrapSibling renames the main-axis margins
  // to `mainMargin*` (they share fields with the cross-axis margins);
  // distributeMainAxis takes a smaller shape so we map at the boundary.
  const finalMainSizes: number[] = new Array(n);
  for (let li = 0; li < numLines; li++) {
    const first = lineFirst[li]!;
    const count = lineCount[li]!;
    const lineSiblings = siblings.slice(first, first + count).map((s) => ({
      basis: s.basis,
      grow: s.grow,
      shrink: s.shrink,
      marginStart: s.mainMarginStart,
      marginEnd: s.mainMarginEnd,
      min: s.min,
      max: s.max,
    }));
    const distributed = distributeMainAxis(lineSiblings, innerMain, mainGap);
    for (let k = 0; k < count; k++) {
      finalMainSizes[first + k] = distributed[k]!;
    }
  }

  // Per-line cross size: container's inner cross for single-line,
  // max of (item.crossSize + cross margins) otherwise.
  const lineCrossSizes: number[] = new Array(numLines);
  if (!isMultiline) {
    lineCrossSizes[0] = innerCross;
  } else {
    for (let li = 0; li < numLines; li++) {
      const first = lineFirst[li]!;
      const count = lineCount[li]!;
      let max = 0;
      for (let k = 0; k < count; k++) {
        const s = siblings[first + k]!;
        // Unclamped natural cross — a clamped item may overflow.
        const candidate = s.crossSizeNatural + s.crossMarginStart + s.crossMarginEnd;
        if (candidate > max) max = candidate;
      }
      lineCrossSizes[li] = max;
    }
  }

  // Per-line cross start (align-content). Single-line: the one line
  // sits at 0. Multi-line: distribute the cross-axis leftover among
  // or around the lines per `alignContent`, mirroring the imperative
  // `positionLinesOnCross`. `stretch` / `auto` grows each line's
  // cross size to absorb the leftover instead.
  const lineCrossStarts: number[] = new Array(numLines);
  if (!isMultiline) {
    lineCrossStarts[0] = 0;
  } else {
    let used = 0;
    for (let li = 0; li < numLines; li++) used += lineCrossSizes[li]!;
    used += (numLines - 1) * crossGap;
    const leftover = innerCross - used;

    let cursor = 0;
    let extraGap = 0;
    let lineSizeBoost = 0;
    switch (alignContent) {
      case 'flex-end':
        cursor = leftover;
        break;
      case 'center':
        cursor = leftover / 2;
        break;
      case 'space-between':
        if (numLines > 1 && leftover > 0) extraGap = leftover / (numLines - 1);
        break;
      case 'space-around':
        if (leftover > 0) {
          const slot = leftover / numLines;
          cursor = slot / 2;
          extraGap = slot;
        }
        break;
      case 'stretch':
      case 'auto':
        if (leftover > 0) lineSizeBoost = leftover / numLines;
        break;
      default:
        // flex-start: lines stacked from the cross start, no extra.
        break;
    }
    for (let li = 0; li < numLines; li++) {
      if (lineSizeBoost > 0) lineCrossSizes[li] = lineCrossSizes[li]! + lineSizeBoost;
      lineCrossStarts[li] = cursor;
      cursor += lineCrossSizes[li]! + crossGap + extraGap;
    }
  }

  // `flex-wrap: wrap-reverse` mirrors the line stack on the cross
  // axis — each line is measured from the cross END. Mirrors the
  // imperative `reverseLineStack`. (A no-op for a single line, whose
  // cross size already fills `innerCross`.)
  if (reverse) {
    for (let li = 0; li < numLines; li++) {
      lineCrossStarts[li] = innerCross - lineCrossStarts[li]! - lineCrossSizes[li]!;
    }
  }

  // Locate the target child.
  let myLine = 0;
  let myPositionInLine = 0;
  for (let li = 0; li < numLines; li++) {
    const first = lineFirst[li]!;
    const count = lineCount[li]!;
    if (childIndex >= first && childIndex < first + count) {
      myLine = li;
      myPositionInLine = childIndex - first;
      break;
    }
  }
  const myLineFirst = lineFirst[myLine]!;
  const myLineCount = lineCount[myLine]!;
  const myLineCrossSize = lineCrossSizes[myLine]!;
  const myLineCrossStart = lineCrossStarts[myLine]!;
  const me = siblings[childIndex]!;

  // justify-content per line: compute leftover from this line's
  // used main, then leading offset / extra gap.
  let usedMain = 0;
  for (let k = 0; k < myLineCount; k++) {
    const idx = myLineFirst + k;
    const s = siblings[idx]!;
    usedMain += finalMainSizes[idx]! + s.mainMarginStart + s.mainMarginEnd;
  }
  if (myLineCount > 1) usedMain += (myLineCount - 1) * mainGap;
  const leftover = Math.max(0, innerMain - usedMain);
  let leadingOffset = 0;
  let extraGap = 0;
  switch (justify) {
    case 'flex-end':
      leadingOffset = leftover;
      break;
    case 'center':
      leadingOffset = leftover / 2;
      break;
    case 'space-between':
      if (myLineCount > 1) extraGap = leftover / (myLineCount - 1);
      break;
    case 'space-around': {
      const slot = leftover / myLineCount;
      leadingOffset = slot / 2;
      extraGap = slot;
      break;
    }
    case 'space-evenly': {
      const slot = leftover / (myLineCount + 1);
      leadingOffset = slot;
      extraGap = slot;
      break;
    }
    default:
      // flex-start
      break;
  }

  // Main-axis cursor walks this line up to the target child.
  let cursor = padMainStart + leadingOffset;
  for (let k = 0; k < myPositionInLine; k++) {
    const idx = myLineFirst + k;
    const s = siblings[idx]!;
    cursor += s.mainMarginStart + finalMainSizes[idx]! + s.mainMarginEnd;
    cursor += mainGap + extraGap;
  }
  cursor += me.mainMarginStart;
  const mainPos = cursor;

  // Cross-axis position via align-items / align-self within line.
  let withinLineCross = me.crossMarginStart;
  if (me.align === 'flex-end') {
    withinLineCross = myLineCrossSize - me.crossSize - me.crossMarginEnd;
  } else if (me.align === 'center') {
    const innerLine = myLineCrossSize - me.crossMarginStart - me.crossMarginEnd;
    withinLineCross = me.crossMarginStart + Math.max(0, (innerLine - me.crossSize) / 2);
  }
  const crossPos = padCrossStart + myLineCrossStart + withinLineCross;

  // Cross size: `align-items: stretch` (the default) resizes an
  // `'auto'` cross to fill the line's inner cross (v14); otherwise
  // the already-clamped `me.crossSize` stands (clamped explicit, or
  // 0 for a non-stretched `'auto'`). Mirrors the imperative
  // `crossAlignItemsInLine` stretch branch.
  let crossSize = me.crossSize;
  if (me.crossIsContentAuto && me.align === 'stretch') {
    const lineInner = myLineCrossSize - me.crossMarginStart - me.crossMarginEnd;
    crossSize = clampMinMax(Math.max(0, lineInner), me.crossMin, me.crossMax);
  }

  return {
    mainSize: finalMainSizes[childIndex]!,
    mainPos,
    crossPos,
    crossSize,
  };
}
