/**
 * Flexbox layout expressed as an attribute grammar.
 *
 * Current slice (v8) covers:
 *
 *   - flex-direction: `row` and `column`
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
 *   - `row-reverse`, `column-reverse`, `wrap-reverse` rejected at
 *     build time
 *
 * Subsequent PRs expand the feature set (align-content variants,
 * wrap-reverse, reverse directions, min/max clamping with the
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
  gapRow?: Field<number>;
  gapColumn?: Field<number>;
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
   * `flexBasis`) and `gap` (`gapRow` / `gapColumn`). Each is a leaf
   * field whose value is the live `node.style` value; every layout
   * field that reads one declares the matching input as a
   * dependency. To drive a precise incremental relayout after a
   * `setWidth` / `setHeight` / `setFlexBasis` / `setGap`, `markDirty`
   * the input Field for the mutated `(node, prop)` and call
   * `recompute()` — propagation then reaches exactly the affected
   * layout fields, with no `markAllDirty`.
   *
   * Padding / margin / flex-grow / flex-shrink are not yet modelled
   * as input fields (they are read live but undeclared); a mutation
   * to those still needs `markAllDirty()`. Subsequent slices convert
   * them.
   */
  styleInputs: Map<Node, StyleInputs>;
}

/**
 * Walk the tree rooted at `root` and emit a `Grammar` that computes
 * each node's `{width, height, left, top}` per the rules above.
 *
 * Requires every node to have `style.width` and `style.height` set to
 * numeric values (the cross-axis side is always used directly; the
 * main-axis side serves as the basis when no `flexBasis` is provided).
 * Throws if either is `'auto'` or `undefined`.
 *
 * @internal
 */
export function buildFlexGrammar(root: Node): FlexGrammarOutput {
  const grammar: Grammar = new Map();
  const allFields: FlexGrammarOutput['allFields'] = [];
  const styleInputs: Map<Node, StyleInputs> = new Map();

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
    if (!grammar.has(f as Field<unknown>)) {
      grammar.set(f as Field<unknown>, {
        deps: [],
        compute: () => n.style[prop] as number,
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
    if (!grammar.has(f as Field<unknown>)) {
      grammar.set(f as Field<unknown>, {
        deps: [],
        compute: () => n.style[prop],
      } satisfies FieldRule<number>);
      styleInputEntry(n)[prop] = f;
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

    // Universal preconditions: direction / wrap / align-content
    // policy applies to every node (in-flow or absolute) since they
    // describe THIS node as a potential flex container.
    const direction = node.style.flexDirection;
    if (direction !== 'row' && direction !== 'column') {
      throw new Error(
        `[flex-grammar] flex-direction '${direction}' is not yet supported; only 'row' and 'column' are implemented in this slice`,
      );
    }
    const wrap = node.style.flexWrap;
    if (wrap === 'wrap-reverse') {
      throw new Error(
        `[flex-grammar] flex-wrap 'wrap-reverse' is not yet supported; only 'nowrap' and 'wrap' are implemented in this slice`,
      );
    }
    if (wrap === 'wrap' && node.style.alignContent !== 'flex-start') {
      throw new Error(
        `[flex-grammar] under flex-wrap='wrap', align-content other than 'flex-start' is not yet supported; got '${node.style.alignContent}'`,
      );
    }

    // Absolute children short-circuit the in-flow flex pipeline:
    // they're positioned independently against the parent's OUTER
    // box (no padding subtraction) using their own `style.position`
    // and `style.margin`. Their width / height can be `'auto'`, with
    // size derived from opposing edges or falling back to 0 — so the
    // in-flow "explicit numeric size" precondition is relaxed here.
    if (parent !== null && node.style.positionType === 'absolute') {
      emitAbsoluteRules(grammar, styleSizeInput, parent, node, width, height, left, top);
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

    // The parent's direction decides which of {width, height} is the
    // main-axis size for THIS child (and which of {left, top} is the
    // main-axis position). Root is parent-less and treats both axes as
    // cross — sizes from style, positions at 0. The cast is safe: the
    // parent was visited before this child, and visit's direction
    // check throws on row-reverse / column-reverse — so a non-null
    // `parentDirection` is provably `'row' | 'column'` here.
    const parentDirection =
      parent === null ? null : (parent.style.flexDirection as 'row' | 'column');
    const mainSizeField =
      parentDirection === 'column' ? (height as Field<unknown>) : (width as Field<unknown>);
    const crossSizeField =
      parentDirection === 'column' ? (width as Field<unknown>) : (height as Field<unknown>);
    const mainPosField =
      parentDirection === 'column' ? (top as Field<unknown>) : (left as Field<unknown>);
    const crossPosField =
      parentDirection === 'column' ? (left as Field<unknown>) : (top as Field<unknown>);
    const mainSizeName: 'width' | 'height' = parentDirection === 'column' ? 'height' : 'width';

    // Parent's spacing for this child: padding along both axes plus
    // this child's own margins. Each is a THUNK, not a captured
    // number — every compute callback below calls it, so a
    // `setPadding` / `setMargin` mutation followed by `markDirty`
    // (or `markAllDirty`) + `recompute()` picks up the new value.
    // Padding / margin are pure numeric offsets: mutating them never
    // reshapes the dependency graph, so live-reading them is always
    // correct. (Structural mutations — flex-direction, flex-wrap
    // on/off, justify / align category — still need a fresh
    // `buildFlexGrammar()`.) All default to 0, reducing v5 to v1-v4
    // when no spacing is set anywhere.
    //
    // `gap` is one step further along: it is modelled as a leaf
    // input Field (see `gapInput`) so its consumers declare it as a
    // dependency and a `setGap` propagates precisely. The thunks for
    // padding / margin are the next slices' conversion targets.
    const padMainStart = (): number =>
      parent === null ? 0 : readPaddingStart(parent, parentDirection!);
    const padMainEnd = (): number =>
      parent === null ? 0 : readPaddingEnd(parent, parentDirection!);
    const padCrossStart = (): number =>
      parent === null ? 0 : readCrossPaddingStart(parent, parentDirection!);
    const padCrossEnd = (): number =>
      parent === null ? 0 : readCrossPaddingEnd(parent, parentDirection!);
    const myMarginMainStart = (): number =>
      parent === null ? 0 : readMarginMainStart(node, parentDirection!);
    const myMarginCrossStart = (): number =>
      parent === null ? 0 : readMarginCrossStart(node, parentDirection!);
    const myMarginCrossEnd = (): number =>
      parent === null ? 0 : readMarginCrossEnd(node, parentDirection!);

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
    if (parent !== null && parent.style.flexWrap === 'wrap') {
      // Capture the in-flow siblings and this child's index among
      // them (both structural — a fresh build is needed if children
      // are inserted / removed). Each sibling's SIZE inputs (basis /
      // main / cross) are declared as deps so a size mutation on any
      // sibling propagates; grow / shrink / margins are still read
      // live and undeclared (a `markAllDirty` slice away).
      const crossKeyName: 'width' | 'height' = parentDirection === 'column' ? 'width' : 'height';
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
      ];
      for (const s of wrapSibs) {
        wrapDeps.push(
          s.flexBasisInput as Field<unknown>,
          s.mainInput as Field<unknown>,
          s.crossInput as Field<unknown>,
        );
      }
      const evalWrapped = (read: ReadFn) => {
        const containerMain = read(parentMainField);
        const containerCross = read(parentCrossField);
        const innerMain = Math.max(0, containerMain - padMainStart() - padMainEnd());
        const innerCross = Math.max(0, containerCross - padCrossStart() - padCrossEnd());
        return evaluateWrappedChild(
          liveWrapSiblings(wrapSibs, parent, read, parentDirection!),
          myIndex,
          innerMain,
          innerCross,
          read(mainGapInput),
          read(crossGapInput),
          justify,
          padMainStart(),
          padCrossStart(),
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
      // child's index (structural); declare each sibling's flexBasis
      // + main-size inputs as deps so a size mutation on any sibling
      // propagates here. grow / shrink / margins stay read-live and
      // undeclared (their input-field slice is still pending). The
      // size is derived from the parent's main-axis size minus
      // padding (the inner main).
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
        });
      }
      const parentMainField = field<number>(parent, mainSizeName);
      const mainGapInput = gapInput(parent, parentDirection === 'column' ? 'row' : 'column');
      const deps: Field<unknown>[] = [
        parentMainField as Field<unknown>,
        mainGapInput as Field<unknown>,
      ];
      for (const s of flexSibs) {
        deps.push(s.flexBasisInput as Field<unknown>, s.mainInput as Field<unknown>);
      }
      grammar.set(mainSizeField, {
        deps,
        compute: (read) => {
          const innerMain = Math.max(0, read(parentMainField) - padMainStart() - padMainEnd());
          const siblings = liveFlexSiblings(flexSibs, read, parentDirection!);
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
      if (parent === null || justify === 'flex-start') {
        grammar.set(mainPosField, {
          deps: [],
          compute: () => padMainStart() + myMarginMainStart(),
        } satisfies FieldRule<number>);
      } else {
        // First child but parent uses non-default justify. Leading
        // offset still depends on leftover, which depends on every
        // sibling's main size.
        emitJustifiedMainPos(
          grammar,
          parent,
          node,
          mainPosField,
          mainSizeName,
          justify,
          indexInParent,
          parentDirection!,
          gapInput(parent, parentDirection === 'column' ? 'row' : 'column'),
        );
      }
    } else if (justify === 'flex-start') {
      // Default main-axis flow: this child's position is a live
      // offset (padding + own leading margin + prior gaps + each
      // prior sibling's margins) plus the sum of prior siblings' main
      // sizes. Prior NODES are captured; their margins are read live.
      const priorMainSizes = priorSiblings.map((s) => field<number>(s, mainSizeName));
      const mainGapInput = gapInput(parent, parentDirection === 'column' ? 'row' : 'column');
      grammar.set(mainPosField, {
        deps: [mainGapInput as Field<unknown>, ...(priorMainSizes as Field<unknown>[])],
        compute: (read) => {
          let sum = padMainStart() + myMarginMainStart() + indexInParent * read(mainGapInput);
          for (const p of priorSiblings) {
            sum += readMarginMainStart(p, parentDirection!);
            sum += readMarginMainEnd(p, parentDirection!);
          }
          for (const m of priorMainSizes) sum += read(m);
          return sum;
        },
      } satisfies FieldRule<number>);
    } else {
      emitJustifiedMainPos(
        grammar,
        parent,
        node,
        mainPosField,
        mainSizeName,
        justify,
        indexInParent,
        parentDirection!,
        gapInput(parent, parentDirection === 'column' ? 'row' : 'column'),
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
          deps: [parentCrossField as Field<unknown>, crossSizeInput as Field<unknown>],
          compute: (read) =>
            read(parentCrossField) - padCrossEnd() - read(crossSizeInput) - myMarginCrossEnd(),
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
        deps: [parentCrossField as Field<unknown>, crossSizeInput as Field<unknown>],
        compute: (read) => {
          const padStart = padCrossStart();
          const innerCross = Math.max(0, read(parentCrossField) - padStart - padCrossEnd());
          const marginStart = myMarginCrossStart();
          const innerLine = innerCross - marginStart - myMarginCrossEnd();
          const myCross = read(crossSizeInput);
          return padStart + marginStart + Math.max(0, (innerLine - myCross) / 2);
        },
      } satisfies FieldRule<number>);
    } else {
      // flex-start, stretch (with explicit cross size — no resize),
      // and any other value (the imperative falls through to
      // flex-start) all share this offset, read live so a padding /
      // margin mutation flows through recompute().
      grammar.set(crossPosField, {
        deps: [],
        compute: () => padCrossStart() + myMarginCrossStart(),
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

  visit(root, null, 0, []);

  const rootW = field<number>(root, 'width');
  const rootH = field<number>(root, 'height');
  const rootL = field<number>(root, 'left');
  const rootT = field<number>(root, 'top');

  return {
    grammar,
    rootFields: { width: rootW, height: rootH, left: rootL, top: rootT },
    allFields,
    styleInputs,
  };
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
}

/**
 * A wrap sibling's SIZE input fields — `SizeInputs` plus the
 * cross-axis size input the wrap line packer needs.
 *
 * @internal
 */
interface WrapSibInputs extends SizeInputs {
  crossInput: Field<number>;
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
 * compute callback from the sibling size input fields (basis) plus a
 * live read of the still-undeclared flex / margin props.
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
 * Basis comes from the declared size input fields via `read`; grow /
 * shrink / margins are still read live from `node.style` (their
 * input-field slice is pending).
 *
 * @internal
 */
function liveFlexSiblings(
  sibs: readonly SizeInputs[],
  read: ReadFn,
  direction: 'row' | 'column',
): FlexSibling[] {
  return sibs.map((s) => ({
    basis: resolveBasisFromRead(read, s.flexBasisInput, s.mainInput),
    grow: s.node.style.flexGrow,
    shrink: s.node.style.flexShrink,
    marginStart: readMarginMainStart(s.node, direction),
    marginEnd: readMarginMainEnd(s.node, direction),
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
  direction: 'row' | 'column',
): WrapSibling[] {
  return sibs.map((s) => {
    const alignSelf = s.node.style.alignSelf;
    return {
      basis: resolveBasisFromRead(read, s.flexBasisInput, s.mainInput),
      grow: s.node.style.flexGrow,
      shrink: s.node.style.flexShrink,
      mainMarginStart: readMarginMainStart(s.node, direction),
      mainMarginEnd: readMarginMainEnd(s.node, direction),
      crossSize: read(s.crossInput),
      crossMarginStart: readMarginCrossStart(s.node, direction),
      crossMarginEnd: readMarginCrossEnd(s.node, direction),
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
 * Padding / margins are read live inside compute (the in-flow
 * sibling NODES are captured; their margins are not), so a spacing
 * mutation flows through recompute() without a fresh build. `gap` is
 * a declared dep — the caller passes its input Field.
 *
 * @internal
 */
function emitJustifiedMainPos(
  grammar: Grammar,
  parent: Node,
  node: Node,
  mainPosField: Field<unknown>,
  mainSizeName: 'width' | 'height',
  justify: Justify,
  indexInParent: number,
  direction: 'row' | 'column',
  gapField: Field<number>,
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
  const n = allSizes.length;
  const parentMainField = field<number>(parent, mainSizeName);
  grammar.set(mainPosField, {
    deps: [
      parentMainField as Field<unknown>,
      gapField as Field<unknown>,
      ...(allSizes as Field<unknown>[]),
    ],
    compute: (read) => {
      const padStart = readPaddingStart(parent, direction);
      const gap = read(gapField);
      const innerMain = Math.max(
        0,
        read(parentMainField) - padStart - readPaddingEnd(parent, direction),
      );
      let usedMain = 0;
      for (let i = 0; i < n; i++) {
        const sib = inFlow[i]!;
        usedMain +=
          read(allSizes[i]!) +
          readMarginMainStart(sib, direction) +
          readMarginMainEnd(sib, direction);
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
        const sib = inFlow[i]!;
        cursor +=
          readMarginMainStart(sib, direction) +
          read(allSizes[i]!) +
          readMarginMainEnd(sib, direction);
        cursor += gap + extraGap;
      }
      cursor += readMarginMainStart(node, direction);
      return cursor;
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

function readPaddingStart(parent: Node, direction: 'row' | 'column'): number {
  return parent.style.padding[mainStartEdge(direction)] ?? 0;
}

function readPaddingEnd(parent: Node, direction: 'row' | 'column'): number {
  return parent.style.padding[mainEndEdge(direction)] ?? 0;
}

function readCrossPaddingStart(parent: Node, direction: 'row' | 'column'): number {
  return parent.style.padding[crossStartEdge(direction)] ?? 0;
}

function readCrossPaddingEnd(parent: Node, direction: 'row' | 'column'): number {
  // Cross axis is perpendicular to the main axis; its end edge sits
  // opposite the cross start edge.
  return parent.style.padding[direction === 'column' ? RIGHT : BOTTOM] ?? 0;
}

function readMarginMainStart(child: Node, direction: 'row' | 'column'): number {
  return child.style.margin[mainStartEdge(direction)] ?? 0;
}

function readMarginMainEnd(child: Node, direction: 'row' | 'column'): number {
  return child.style.margin[mainEndEdge(direction)] ?? 0;
}

function readMarginCrossStart(child: Node, direction: 'row' | 'column'): number {
  return child.style.margin[crossStartEdge(direction)] ?? 0;
}

function readMarginCrossEnd(child: Node, direction: 'row' | 'column'): number {
  return child.style.margin[direction === 'column' ? RIGHT : BOTTOM] ?? 0;
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
  // Margins are read live (thunks) so a `setMargin` on the absolute
  // child flows through markDirty + recompute. The `position` edges
  // stay captured: their presence selects the branch (structural).
  const marginTop = (): number => child.style.margin[TOP] ?? 0;
  const marginRight = (): number => child.style.margin[RIGHT] ?? 0;
  const marginBottom = (): number => child.style.margin[BOTTOM] ?? 0;
  const marginLeft = (): number => child.style.margin[LEFT] ?? 0;
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
      deps: [parentWField as Field<unknown>],
      compute: (read) =>
        Math.max(0, read(parentWField) - posLeft - posRight - marginLeft() - marginRight()),
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
      deps: [parentHField as Field<unknown>],
      compute: (read) =>
        Math.max(0, read(parentHField) - posTop - posBottom - marginTop() - marginBottom()),
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
      deps: [],
      compute: () => posLeft + marginLeft(),
    } satisfies FieldRule<number>);
  } else if (posRight !== undefined) {
    grammar.set(left as Field<unknown>, {
      deps: [parentWField as Field<unknown>, width as Field<unknown>],
      compute: (read) => read(parentWField) - read(width) - posRight - marginRight(),
    } satisfies FieldRule<number>);
  } else {
    grammar.set(left as Field<unknown>, {
      deps: [],
      compute: () => marginLeft(),
    } satisfies FieldRule<number>);
  }

  // Top
  if (posTop !== undefined) {
    grammar.set(top as Field<unknown>, {
      deps: [],
      compute: () => posTop + marginTop(),
    } satisfies FieldRule<number>);
  } else if (posBottom !== undefined) {
    grammar.set(top as Field<unknown>, {
      deps: [parentHField as Field<unknown>, height as Field<unknown>],
      compute: (read) => read(parentHField) - read(height) - posBottom - marginBottom(),
    } satisfies FieldRule<number>);
  } else {
    grammar.set(top as Field<unknown>, {
      deps: [],
      compute: () => marginTop(),
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
 * `computeLineCrossSizes` → `positionLinesOnCross` →
 * `positionItemsInLine` → `crossAlignItemsInLine` chain. The
 * single-line case (one packed line) collapses crossSize to
 * `innerCross` and crossPos of the line to 0, matching the
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

  // Per-line cross start: 0 for single-line; cumulative + crossGap
  // for multi-line (matches imperative's positionLinesOnCross with
  // align-content='flex-start').
  const lineCrossStarts: number[] = new Array(numLines);
  if (!isMultiline) {
    lineCrossStarts[0] = 0;
  } else {
    let cursor = 0;
    for (let li = 0; li < numLines; li++) {
      lineCrossStarts[li] = cursor;
      cursor += lineCrossSizes[li]! + crossGap;
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
