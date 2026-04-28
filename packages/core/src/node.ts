/**
 * The Node class — the imperative API for building a layout tree.
 *
 * Style setters mirror Yoga's surface and CSS Flexbox semantics. The actual
 * layout algorithm is filled in across milestones M4-M6; in M3, the API
 * surface and tree mutation are complete but `calculateLayout()` throws so
 * that downstream code can lock in against the API while the algorithm is
 * built.
 *
 * Each Node owns:
 *   - `style`     — mutable style state, see `style.ts`.
 *   - `layout`    — last computed layout box (left/top/width/height).
 *   - `children`  — ordered list of child nodes.
 *   - `parent`    — back-pointer; `null` for the root.
 *   - `measure`   — optional measure function for leaf intrinsic sizing.
 *   - `dirty`     — set on style/tree mutation; consumed by the algorithm.
 */

import { Edge } from './edge.js';
import { type ComputedLayout, defaultLayout } from './layout.js';
import type { MeasureFunc } from './measure-func.js';
import {
  type Align,
  type Display,
  type FlexDirection,
  type FlexWrap,
  type Justify,
  type Length,
  type PositionType,
  type Style,
  defaultStyle,
} from './style.js';

const TOP = 0;
const RIGHT = 1;
const BOTTOM = 2;
const LEFT = 3;

function clampNonNegative(n: number): number {
  return n < 0 ? 0 : n;
}

function nonNegativeOrThrow(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a finite non-negative number, got ${value}`);
  }
  return value;
}

export class Node {
  /** Public-but-internal: read by the layout algorithm and by `getComputedLayout`. */
  readonly style: Style = defaultStyle();
  readonly layout: ComputedLayout = defaultLayout();

  private readonly _children: Node[] = [];
  private _parent: Node | null = null;
  private _measure: MeasureFunc | null = null;
  /** True if style or tree has changed since the last `calculateLayout()`. */
  private _dirty = true;

  /** Construct via `Node.create()` to mirror Yoga's factory style. */
  static create(): Node {
    return new Node();
  }

  // ─── tree mutation ─────────────────────────────────────────────────────

  insertChild(child: Node, index: number): void {
    if (child === this) throw new Error('cannot insert a node into itself');
    if (child._parent !== null) {
      throw new Error('child already has a parent; remove it first');
    }
    if (this._measure !== null) {
      throw new Error('cannot add children to a node with a measure function');
    }
    const i = Math.max(0, Math.min(index, this._children.length));
    this._children.splice(i, 0, child);
    child._parent = this;
    this.markDirty();
  }

  removeChild(child: Node): void {
    const idx = this._children.indexOf(child);
    if (idx === -1) return;
    this._children.splice(idx, 1);
    child._parent = null;
    this.markDirty();
  }

  getChild(index: number): Node | undefined {
    return this._children[index];
  }

  getChildCount(): number {
    return this._children.length;
  }

  /** Snapshot of children — mutating the returned array does not affect the tree. */
  getChildren(): Node[] {
    return this._children.slice();
  }

  getParent(): Node | null {
    return this._parent;
  }

  isRoot(): boolean {
    return this._parent === null;
  }

  // ─── measure function ──────────────────────────────────────────────────

  setMeasureFunc(fn: MeasureFunc | null): void {
    if (fn !== null && this._children.length > 0) {
      throw new Error('cannot set a measure function on a node with children');
    }
    this._measure = fn;
    this.markDirty();
  }

  getMeasureFunc(): MeasureFunc | null {
    return this._measure;
  }

  // ─── flex direction / wrap / flex shorthand ───────────────────────────

  setFlexDirection(value: FlexDirection): void {
    this.style.flexDirection = value;
    this.markDirty();
  }

  setFlexWrap(value: FlexWrap): void {
    this.style.flexWrap = value;
    this.markDirty();
  }

  /** CSS `flex` shorthand: grow=value, shrink=1, basis=0 (when value > 0). */
  setFlex(value: number): void {
    if (!Number.isFinite(value)) throw new RangeError(`flex must be finite, got ${value}`);
    if (value > 0) {
      this.style.flexGrow = value;
      this.style.flexShrink = 1;
      this.style.flexBasis = 0;
    } else if (value < 0) {
      this.style.flexGrow = 0;
      this.style.flexShrink = -value;
      this.style.flexBasis = 'auto';
    } else {
      this.style.flexGrow = 0;
      this.style.flexShrink = 0;
      this.style.flexBasis = 'auto';
    }
    this.markDirty();
  }

  setFlexGrow(value: number): void {
    this.style.flexGrow = clampNonNegative(value);
    this.markDirty();
  }

  setFlexShrink(value: number): void {
    this.style.flexShrink = clampNonNegative(value);
    this.markDirty();
  }

  setFlexBasis(value: Length): void {
    if (value !== 'auto') nonNegativeOrThrow(value, 'flexBasis');
    this.style.flexBasis = value;
    this.markDirty();
  }

  // ─── sizing ────────────────────────────────────────────────────────────

  setWidth(value: Length): void {
    if (value !== 'auto') nonNegativeOrThrow(value, 'width');
    this.style.width = value;
    this.markDirty();
  }

  setHeight(value: Length): void {
    if (value !== 'auto') nonNegativeOrThrow(value, 'height');
    this.style.height = value;
    this.markDirty();
  }

  setMinWidth(value: number): void {
    this.style.minWidth = nonNegativeOrThrow(value, 'minWidth');
    this.markDirty();
  }

  setMinHeight(value: number): void {
    this.style.minHeight = nonNegativeOrThrow(value, 'minHeight');
    this.markDirty();
  }

  /** Pass `undefined` to remove an upper bound. */
  setMaxWidth(value: number | undefined): void {
    if (value !== undefined) nonNegativeOrThrow(value, 'maxWidth');
    this.style.maxWidth = value;
    this.markDirty();
  }

  /** Pass `undefined` to remove an upper bound. */
  setMaxHeight(value: number | undefined): void {
    if (value !== undefined) nonNegativeOrThrow(value, 'maxHeight');
    this.style.maxHeight = value;
    this.markDirty();
  }

  // ─── padding / margin / gap ────────────────────────────────────────────

  setPadding(edge: Edge, value: number): void {
    nonNegativeOrThrow(value, 'padding');
    writeEdge(this.style.padding, edge, value);
    this.markDirty();
  }

  setMargin(edge: Edge, value: number): void {
    nonNegativeOrThrow(value, 'margin');
    writeEdge(this.style.margin, edge, value);
    this.markDirty();
  }

  setGap(axis: 'row' | 'column', value: number): void {
    nonNegativeOrThrow(value, 'gap');
    if (axis === 'row') this.style.gapRow = value;
    else this.style.gapColumn = value;
    this.markDirty();
  }

  // ─── alignment ─────────────────────────────────────────────────────────

  setJustifyContent(value: Justify): void {
    this.style.justifyContent = value;
    this.markDirty();
  }

  setAlignItems(value: Align): void {
    this.style.alignItems = value;
    this.markDirty();
  }

  setAlignContent(value: Align): void {
    this.style.alignContent = value;
    this.markDirty();
  }

  setAlignSelf(value: Align): void {
    this.style.alignSelf = value;
    this.markDirty();
  }

  // ─── positioning ───────────────────────────────────────────────────────

  setPositionType(value: PositionType): void {
    this.style.positionType = value;
    this.markDirty();
  }

  /** Pass `undefined` to leave that edge unconstrained. */
  setPosition(edge: Edge, value: number | undefined): void {
    if (value !== undefined && !Number.isFinite(value)) {
      throw new RangeError(`position must be finite or undefined, got ${value}`);
    }
    writePositionEdge(this.style.position, edge, value);
    this.markDirty();
  }

  // ─── display ───────────────────────────────────────────────────────────

  setDisplay(value: Display): void {
    this.style.display = value;
    this.markDirty();
  }

  // ─── layout entry points ───────────────────────────────────────────────

  /**
   * Compute layout for this node and its descendants.
   *
   * If `availableWidth` / `availableHeight` are omitted the node's own
   * `width` / `height` style is used. If those are also `'auto'` the
   * algorithm treats the missing axis as unconstrained.
   *
   * NOTE: the algorithm is implemented across milestones M4-M6. In M3 this
   * is a stub that throws so downstream code can integrate against the
   * stable API surface.
   */
  calculateLayout(_availableWidth?: number, _availableHeight?: number): void {
    throw new Error(
      'calculateLayout is not implemented yet; the flex algorithm lands in milestone M4.',
    );
  }

  /**
   * Returns the most recently computed layout box for this node, in cells,
   * relative to the parent's top-left corner.
   *
   * Before `calculateLayout()` has run, all values are 0.
   */
  getComputedLayout(): ComputedLayout {
    return { ...this.layout };
  }

  // ─── dirty tracking ────────────────────────────────────────────────────

  /**
   * Walk up the tree marking every ancestor dirty too. The algorithm uses
   * this hint to short-circuit work in subtrees that did not change.
   */
  markDirty(): void {
    this._dirty = true;
    if (this._parent !== null && !this._parent._dirty) this._parent.markDirty();
  }

  isDirty(): boolean {
    return this._dirty;
  }

  /** Internal: called by the algorithm once layout is fresh. */
  clearDirty(): void {
    this._dirty = false;
  }
}

function writeEdge(box: [number, number, number, number], edge: Edge, value: number): void {
  switch (edge) {
    case Edge.Top:
      box[TOP] = value;
      return;
    case Edge.Right:
      box[RIGHT] = value;
      return;
    case Edge.Bottom:
      box[BOTTOM] = value;
      return;
    case Edge.Left:
      box[LEFT] = value;
      return;
    case Edge.Horizontal:
      box[LEFT] = value;
      box[RIGHT] = value;
      return;
    case Edge.Vertical:
      box[TOP] = value;
      box[BOTTOM] = value;
      return;
    case Edge.All:
      box[TOP] = value;
      box[RIGHT] = value;
      box[BOTTOM] = value;
      box[LEFT] = value;
      return;
  }
}

function writePositionEdge(
  box: [number | undefined, number | undefined, number | undefined, number | undefined],
  edge: Edge,
  value: number | undefined,
): void {
  switch (edge) {
    case Edge.Top:
      box[TOP] = value;
      return;
    case Edge.Right:
      box[RIGHT] = value;
      return;
    case Edge.Bottom:
      box[BOTTOM] = value;
      return;
    case Edge.Left:
      box[LEFT] = value;
      return;
    case Edge.Horizontal:
      box[LEFT] = value;
      box[RIGHT] = value;
      return;
    case Edge.Vertical:
      box[TOP] = value;
      box[BOTTOM] = value;
      return;
    case Edge.All:
      box[TOP] = value;
      box[RIGHT] = value;
      box[BOTTOM] = value;
      box[LEFT] = value;
      return;
  }
}
