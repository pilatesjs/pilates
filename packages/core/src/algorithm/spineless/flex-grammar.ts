/**
 * Flexbox layout expressed as an attribute grammar.
 *
 * Current slice (v11) covers:
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
 *
 * Subsequent PRs expand the feature set (min/max clamping with the
 * multi-iteration freeze loop) one chunk at a time, each gated by a
 * differential test that asserts the grammar produces byte-identical
 * output to the imperative algorithm.
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
  const { grammar, allFields, styleInputs, boundary } = ctx;

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
        if (child.style.positionType === 'absolute') {
          visit(child, node, -1, []);
        } else {
          visit(child, node, childSiblings.length, [...childSiblings]);
          childSiblings.push(child);
        }
      }
      return;
    }

    // In-flow precondition: every node has an explicit numeric basis
    // on both axes.
    const styleWRaw = node.style.width;
    const styleHRaw = node.style.height;
    if (typeof styleWRaw !== 'number') {
      throw new Error(
        `[flex-grammar] node requires explicit numeric width; got ${JSON.stringify(styleWRaw)}`,
      );
    }
    if (typeof styleHRaw !== 'number') {
      throw new Error(
        `[flex-grammar] node requires explicit numeric height; got ${JSON.stringify(styleHRaw)}`,
      );
    }
    // styleWRaw / styleHRaw are now type-asserted numbers (proved by
    // the preceding checks). Compute callbacks re-read `node.style`
    // live so width / height mutations propagate through recompute()
    // — these declarations stay only to gate the build-time
    // precondition, not to be captured.
    void styleWRaw;
    void styleHRaw;

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
    const myMarginMainStartF =
      parent === null ? null : marginInput(node, mainStartEdge(parentDirection!));
    const myMarginCrossStartF =
      parent === null ? null : marginInput(node, crossStartEdge(parentDirection!));
    const myMarginCrossEndF =
      parent === null ? null : marginInput(node, crossEndEdge(parentDirection!));

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

    // This node's own resolved basis: flexBasis if numeric, otherwise
    // style.{width|height}. Both the no-flex-distribution path (basis
    // == final size) and the flex-distribution path use this value.
    // Cross-axis size: reads the cross-axis style input field
    // directly (no stretch in this slice). Declaring the input as a
    // dep means `markDirty(crossSizeInput)` after a `setWidth` /
    // `setHeight` reaches this field precisely.
    const crossKey: 'width' | 'height' = parentDirection === 'column' ? 'width' : 'height';
    const crossSizeInput = styleSizeInput(node, crossKey);
    grammar.set(crossSizeField, {
      deps: [crossSizeInput as Field<unknown>],
      compute: (read) => read(crossSizeInput),
    } satisfies FieldRule<number>);

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
        if (sib.style.positionType === 'absolute') continue;
        if (sib === node) myIndex = wrapSibs.length;
        wrapSibs.push({
          node: sib,
          flexBasisInput: styleSizeInput(sib, 'flexBasis'),
          mainInput: styleSizeInput(sib, mainSizeName),
          crossInput: styleSizeInput(sib, crossKeyName),
          growInput: flexWeightInput(sib, 'flexGrow'),
          shrinkInput: flexWeightInput(sib, 'flexShrink'),
          marginMainStartInput: marginInput(sib, mainStart),
          marginMainEndInput: marginInput(sib, mainEnd),
          marginCrossStartInput: marginInput(sib, crossStart),
          marginCrossEndInput: marginInput(sib, crossEnd),
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
      allFields.push({ node, width, height, left, top });
      // Recurse into children.
      const childCount = node.getChildCount();
      const childSiblings: Node[] = [];
      for (let i = 0; i < childCount; i++) {
        const child = node.getChild(i)!;
        visit(child, node, i, [...childSiblings]);
        childSiblings.push(child);
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
      // No flex distribution: this node's main size IS its resolved
      // basis. Declare deps on the node's own flexBasis + main-size
      // inputs so a size mutation reaches this field precisely.
      const flexBasisInput = styleSizeInput(node, 'flexBasis');
      const mainInput = styleSizeInput(node, mainSizeName);
      grammar.set(mainSizeField, {
        deps: [flexBasisInput as Field<unknown>, mainInput as Field<unknown>],
        compute: (read) => resolveBasisFromRead(read, flexBasisInput, mainInput),
      } satisfies FieldRule<number>);
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
        if (sib.style.positionType === 'absolute') continue;
        if (sib === node) myIndex = flexSibs.length;
        flexSibs.push({
          node: sib,
          flexBasisInput: styleSizeInput(sib, 'flexBasis'),
          mainInput: styleSizeInput(sib, mainSizeName),
          growInput: flexWeightInput(sib, 'flexGrow'),
          shrinkInput: flexWeightInput(sib, 'flexShrink'),
          marginMainStartInput: marginInput(sib, flexMainStart),
          marginMainEndInput: marginInput(sib, flexMainEnd),
        });
      }
      const parentMainField = field<number>(parent, mainSizeName);
      const mainGapInput = gapInput(parent, parentDirection === 'column' ? 'row' : 'column');
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
        grammar.set(mainPosField, {
          deps: [padMainStartF as Field<unknown>, myMarginMainStartF as Field<unknown>],
          compute: (read) => read(padMainStartF!) + read(myMarginMainStartF!),
        } satisfies FieldRule<number>);
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
      // Default main-axis flow: this child's position is an offset
      // (padding + own leading margin + prior gaps + each prior
      // sibling's main-axis margins) plus the sum of prior siblings'
      // main sizes — all declared deps so a size / spacing mutation
      // on any prior sibling propagates here.
      const priorMainSizes = priorSiblings.map((s) => field<number>(s, mainSizeName));
      const priorMargins = priorSiblings.map((s) => ({
        start: marginInput(s, mainStartEdge(parentDirection!)),
        end: marginInput(s, mainEndEdge(parentDirection!)),
      }));
      const mainGapInput = gapInput(parent, parentDirection === 'column' ? 'row' : 'column');
      grammar.set(mainPosField, {
        deps: [
          mainGapInput as Field<unknown>,
          padMainStartF as Field<unknown>,
          myMarginMainStartF as Field<unknown>,
          ...(priorMainSizes as Field<unknown>[]),
          ...priorMargins.flatMap((m) => [m.start, m.end] as Field<unknown>[]),
        ],
        compute: (read) => {
          let sum =
            read(padMainStartF!) + read(myMarginMainStartF!) + indexInParent * read(mainGapInput);
          for (const m of priorMargins) sum += read(m.start) + read(m.end);
          for (const m of priorMainSizes) sum += read(m);
          return sum;
        },
      } satisfies FieldRule<number>);
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
        grammar.set(crossPosField, {
          deps: [
            parentCrossField as Field<unknown>,
            crossSizeInput as Field<unknown>,
            padCrossEndF as Field<unknown>,
            myMarginCrossEndF as Field<unknown>,
          ],
          compute: (read) =>
            read(parentCrossField) -
            read(padCrossEndF!) -
            read(crossSizeInput) -
            read(myMarginCrossEndF!),
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
      grammar.set(crossPosField, {
        deps: [
          parentCrossField as Field<unknown>,
          crossSizeInput as Field<unknown>,
          padCrossStartF as Field<unknown>,
          padCrossEndF as Field<unknown>,
          myMarginCrossStartF as Field<unknown>,
          myMarginCrossEndF as Field<unknown>,
        ],
        compute: (read) => {
          const padStart = read(padCrossStartF!);
          const innerCross = Math.max(0, read(parentCrossField) - padStart - read(padCrossEndF!));
          const marginStart = read(myMarginCrossStartF!);
          const innerLine = innerCross - marginStart - read(myMarginCrossEndF!);
          const myCross = read(crossSizeInput);
          return padStart + marginStart + Math.max(0, (innerLine - myCross) / 2);
        },
      } satisfies FieldRule<number>);
    } else {
      // flex-start, stretch (with explicit cross size — no resize),
      // and any other value (the imperative falls through to
      // flex-start) all share this offset: the parent's cross-start
      // padding plus this child's cross-start margin, both declared
      // input deps.
      grammar.set(crossPosField, {
        deps: [padCrossStartF as Field<unknown>, myMarginCrossStartF as Field<unknown>],
        compute: (read) => read(padCrossStartF!) + read(myMarginCrossStartF!),
      } satisfies FieldRule<number>);
    }

    allFields.push({ node, width, height, left, top });

    // Recurse into children. Absolute children are out-of-flow: they
    // get visited (so their own subtree emits rules) but they don't
    // contribute to the in-flow sibling index or the priorSiblings
    // list that fuels positioning of subsequent in-flow siblings.
    const childCount = node.getChildCount();
    const inFlowSiblings: Node[] = [];
    for (let i = 0; i < childCount; i++) {
      const child = node.getChild(i)!;
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
 * Requires every in-flow node to have numeric `style.width` /
 * `style.height`; throws otherwise.
 *
 * @internal
 */
export function buildFlexGrammar(root: Node): FlexGrammarOutput {
  const grammar: Grammar = new Map();
  const allFields: FlexGrammarOutput['allFields'] = [];
  const styleInputs: Map<Node, StyleInputs> = new Map();
  makeEmitter({ grammar, allFields, styleInputs, boundary: null })(root, null, 0, []);

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
): Map<Node, StyleInputs> {
  const merged = new Map(base);
  for (const [node, entry] of extra) {
    const existing = merged.get(node);
    merged.set(node, existing === undefined ? entry : mergeStyleInputs(existing, entry));
  }
  return merged;
}

/**
 * Fast-path a child APPEND for the Spineless runtime. If appending
 * `child` as `parent`'s last child can be absorbed without a fresh
 * runtime, return the patch inputs; return `null` when a full
 * rebuild is required — `child` is not the last child, or `parent`
 * uses a reverse `flex-direction` (supported by the grammar since
 * v11, but not yet by this structural fast-path — reflecting every
 * sibling's position is a whole-subtree rewrite).
 *
 * The new subtree's fields are always a pure topological-tail
 * addition handled by `graft` (`additions` / `newRoots`). When
 * `parent` is in the "simple" regime (no flex distribution, default
 * `flex-start` justify, no wrap — or `child` is absolute) that is
 * the whole patch and `rebinds` is empty, and the fragment is built
 * in **O(subtree)** — `makeEmitter` emits just the appended subtree
 * against the runtime's grammar as a boundary, no whole-tree
 * rebuild. Otherwise appending also grows every existing in-flow
 * sibling's dependency set (flex distribution / justify leftover /
 * wrap packing all read every sibling), so the grammar is rebuilt
 * O(tree) and `rebinds` carries those siblings' rewritten rules.
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
): AppendFragment | null {
  // `child` must be the parent's last child — a mid-list insert
  // shifts later siblings, which is not a topological-tail graft.
  const count = parent.getChildCount();
  if (count === 0 || parent.getChild(count - 1) !== child) return null;

  // A reverse-direction parent is supported by the grammar (v11) but
  // not by this fast-path: the flip reflects every sibling, so fall
  // back to a full rebuild.
  const dir = parent.style.flexDirection;
  if (dir !== 'row' && dir !== 'column') return null;

  // An absolute child never perturbs in-flow siblings; otherwise the
  // parent's regime decides whether existing siblings are rewritten.
  const simple =
    child.style.positionType === 'absolute' ||
    (parent.style.flexWrap === 'nowrap' &&
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
    };
    const priors: Node[] = [];
    for (let i = 0; i < count - 1; i++) {
      const sib = parent.getChild(i)!;
      if (sib.style.positionType !== 'absolute') priors.push(sib);
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
      styleInputs: mergeStyleInputsMap(prev.styleInputs, ctx.styleInputs),
    };
    return { additions: ctx.grammar, newRoots, rebinds: [], next };
  }

  // Non-simple: appending rewrites every surviving sibling's rules.
  // Rebuild the grammar O(tree) and diff it against `prev` for the
  // new fields; Field identity is stable across builds, so a key
  // absent from `prev.grammar` belongs to a newly-added node.
  const fresh = buildFlexGrammar(root);
  const additions: Grammar = new Map();
  for (const [f, rule] of fresh.grammar) {
    if (!prev.grammar.has(f)) additions.set(f, rule);
  }
  const newRoots: Array<Field<unknown>> = [];
  for (const e of fresh.allFields) {
    if (!prev.grammar.has(e.width as Field<unknown>)) {
      newRoots.push(
        e.width as Field<unknown>,
        e.height as Field<unknown>,
        e.left as Field<unknown>,
        e.top as Field<unknown>,
      );
    }
  }
  const rebinds: Array<[Field<unknown>, FieldRule<unknown>]> = [];
  for (let i = 0; i < parent.getChildCount(); i++) {
    const sib = parent.getChild(i)!;
    if (sib === child || sib.style.positionType === 'absolute') continue;
    for (const name of ['width', 'height', 'left', 'top'] as const) {
      const f = field<number>(sib, name) as Field<unknown>;
      const rule = fresh.grammar.get(f);
      if (rule !== undefined) rebinds.push([f, rule]);
    }
  }
  const next: FlexGrammarOutput = {
    grammar: prev.grammar,
    rootFields: prev.rootFields,
    allFields: fresh.allFields,
    styleInputs: fresh.styleInputs,
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

/** Every grammar field belonging to `node` — its four layout fields
 *  plus its style input fields recorded in `styleInputs`. */
function nodeFields(node: Node, styleInputs: Map<Node, StyleInputs>): Array<Field<unknown>> {
  const out: Array<Field<unknown>> = [
    field<number>(node, 'width') as Field<unknown>,
    field<number>(node, 'height') as Field<unknown>,
    field<number>(node, 'left') as Field<unknown>,
    field<number>(node, 'top') as Field<unknown>,
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
    const next: FlexGrammarOutput = {
      grammar: prev.grammar,
      rootFields: prev.rootFields,
      allFields: prev.allFields.filter((e) => !removedNodes.has(e.node)),
      styleInputs: new Map([...prev.styleInputs].filter(([n]) => !removedNodes.has(n))),
    };
    return { removed, rebinds: [], next };
  }

  // Non-simple: the removal rewrites every surviving sibling's rules.
  // Rebuild the grammar O(tree) — detach `child` around the build,
  // then restore the tree — and diff `prev \ fresh` for `removed`.
  parent.removeChild(child);
  const fresh = buildFlexGrammar(root);
  parent.insertChild(child, index);

  const removed: Array<Field<unknown>> = [];
  for (const f of prev.grammar.keys()) {
    if (!fresh.grammar.has(f)) removed.push(f);
  }
  const rebinds: Array<[Field<unknown>, FieldRule<unknown>]> = [];
  for (let i = 0; i < parent.getChildCount(); i++) {
    const sib = parent.getChild(i)!;
    if (sib === child || sib.style.positionType === 'absolute') continue;
    for (const name of ['width', 'height', 'left', 'top'] as const) {
      const f = field<number>(sib, name) as Field<unknown>;
      const rule = fresh.grammar.get(f);
      if (rule !== undefined) rebinds.push([f, rule]);
    }
  }
  const next: FlexGrammarOutput = {
    grammar: prev.grammar,
    rootFields: prev.rootFields,
    allFields: fresh.allFields,
    styleInputs: fresh.styleInputs,
  };
  return { removed, rebinds, next };
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
}

/**
 * A wrap sibling's input fields — `SizeInputs` plus the cross-axis
 * size and cross-axis margin inputs the wrap line packer needs.
 *
 * @internal
 */
interface WrapSibInputs extends SizeInputs {
  crossInput: Field<number>;
  marginCrossStartInput: Field<number>;
  marginCrossEndInput: Field<number>;
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
    return {
      basis: resolveBasisFromRead(read, s.flexBasisInput, s.mainInput),
      grow: read(s.growInput),
      shrink: read(s.shrinkInput),
      mainMarginStart: read(s.marginMainStartInput),
      mainMarginEnd: read(s.marginMainEndInput),
      crossSize: read(s.crossInput),
      crossMarginStart: read(s.marginCrossStartInput),
      crossMarginEnd: read(s.marginCrossEndInput),
      align: alignSelf === 'auto' ? parent.style.alignItems : alignSelf,
    };
  });
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
  // In-flow siblings only — absolute children don't contribute to
  // justify-content's leftover calculation.
  const inFlow: Node[] = [];
  for (let i = 0; i < parent.getChildCount(); i++) {
    const sib = parent.getChild(i)!;
    if (sib.style.positionType === 'absolute') continue;
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
 * True iff a parent's children carry any flex property that lets a
 * child's main size differ from its raw `style.{width|height}`: a
 * positive grow weight, a positive shrink weight, or a numeric
 * `flexBasis`.
 */
function parentNeedsFlexDistribution(parent: Node): boolean {
  const count = parent.getChildCount();
  for (let i = 0; i < count; i++) {
    const c = parent.getChild(i)!;
    if (c.style.positionType === 'absolute') continue;
    const s = c.style;
    if (s.flexGrow > 0) return true;
    if (s.flexShrink > 0) return true;
    if (typeof s.flexBasis === 'number') return true;
  }
  return false;
}

/**
 * Distribute `budget` across siblings using CSS flex semantics
 * (without min/max clamping). Returns each sibling's final main-axis
 * size in input order.
 *
 * `budget` is the parent's inner main size (containerMain minus
 * leading + trailing padding). Margins and gaps are accounted for via
 * the hypothetical sum: only the basis part of each sibling expands
 * (grow) or contracts (shrink); margins and gaps are fixed-width
 * spacers that consume budget but never resize.
 *
 * Mirrors the imperative `distributeGrow` / `distributeShrink` in
 * `main-axis.ts`. Without clamping the CSS freeze loop terminates in
 * one iteration for either branch, so we fold it down to a single
 * pass:
 *
 *   - leftover > 0 and any grow weight > 0 → each grow-positive
 *     sibling receives `(leftover * grow) / totalGrow`.
 *   - leftover < 0 and any shrink weight > 0 → each shrink-positive
 *     sibling loses `(overflow * shrink * basis) / sum(shrink * basis)`.
 *   - otherwise → every sibling stays at its basis.
 *
 * @internal
 */
function distributeMainAxis(
  siblings: readonly {
    basis: number;
    grow: number;
    shrink: number;
    marginStart: number;
    marginEnd: number;
  }[],
  budget: number,
  gap: number,
): number[] {
  let hypothetical = 0;
  let totalGrow = 0;
  let totalShrinkScaled = 0;
  for (const s of siblings) {
    hypothetical += s.basis + s.marginStart + s.marginEnd;
    if (s.grow > 0) totalGrow += s.grow;
    if (s.shrink > 0) totalShrinkScaled += s.shrink * s.basis;
  }
  if (siblings.length > 1) hypothetical += (siblings.length - 1) * gap;
  const leftover = budget - hypothetical;
  if (leftover > 0 && totalGrow > 0) {
    return siblings.map((s) => (s.grow > 0 ? s.basis + (leftover * s.grow) / totalGrow : s.basis));
  }
  if (leftover < 0 && totalShrinkScaled > 0) {
    const overflow = -leftover;
    return siblings.map((s) => {
      if (s.shrink <= 0) return s.basis;
      const scaled = s.shrink * s.basis;
      const reduction = (overflow * scaled) / totalShrinkScaled;
      return s.basis - reduction;
    });
  }
  return siblings.map((s) => s.basis);
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
 * matches Yoga / RN semantics that Pilates follows. No min/max
 * clamping in this slice (matches every other v8-and-prior slice).
 *
 * @internal
 */
function emitAbsoluteRules(
  grammar: Grammar,
  styleSizeInput: (n: Node, prop: 'width' | 'height' | 'flexBasis') => Field<number>,
  marginInput: (n: Node, edge: number) => Field<number>,
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

  // Width. The explicit-width branch reads the child's `style:width`
  // input field, so a `setWidth` on the absolute child propagates
  // precisely through markDirty + recompute. Mutating the child from
  // explicit to 'auto' (or vice-versa) requires a fresh grammar build
  // since that crosses branch boundaries — out of scope here.
  if (typeof styleW === 'number') {
    const wInput = styleSizeInput(child, 'width');
    grammar.set(width as Field<unknown>, {
      deps: [wInput as Field<unknown>],
      compute: (read) => read(wInput),
    } satisfies FieldRule<number>);
  } else if (posLeft !== undefined && posRight !== undefined) {
    grammar.set(width as Field<unknown>, {
      deps: [parentWField as Field<unknown>, mLeft as Field<unknown>, mRight as Field<unknown>],
      compute: (read) =>
        Math.max(0, read(parentWField) - posLeft - posRight - read(mLeft) - read(mRight)),
    } satisfies FieldRule<number>);
  } else {
    grammar.set(width as Field<unknown>, {
      deps: [],
      compute: () => 0,
    } satisfies FieldRule<number>);
  }

  // Height — symmetric to width.
  if (typeof styleH === 'number') {
    const hInput = styleSizeInput(child, 'height');
    grammar.set(height as Field<unknown>, {
      deps: [hInput as Field<unknown>],
      compute: (read) => read(hInput),
    } satisfies FieldRule<number>);
  } else if (posTop !== undefined && posBottom !== undefined) {
    grammar.set(height as Field<unknown>, {
      deps: [parentHField as Field<unknown>, mTop as Field<unknown>, mBottom as Field<unknown>],
      compute: (read) =>
        Math.max(0, read(parentHField) - posTop - posBottom - read(mTop) - read(mBottom)),
    } satisfies FieldRule<number>);
  } else {
    grammar.set(height as Field<unknown>, {
      deps: [],
      compute: () => 0,
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
  mainMarginStart: number;
  mainMarginEnd: number;
  crossSize: number;
  crossMarginStart: number;
  crossMarginEnd: number;
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
): { mainSize: number; mainPos: number; crossPos: number } {
  const n = siblings.length;

  // Pack greedily, recording per-line start index and count.
  const lineFirst: number[] = [];
  const lineCount: number[] = [];
  {
    let start = 0;
    let acc = 0;
    for (let i = 0; i < n; i++) {
      const s = siblings[i]!;
      const itemMain = s.basis + s.mainMarginStart + s.mainMarginEnd;
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
        const candidate = s.crossSize + s.crossMarginStart + s.crossMarginEnd;
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

  return {
    mainSize: finalMainSizes[childIndex]!,
    mainPos,
    crossPos,
  };
}
