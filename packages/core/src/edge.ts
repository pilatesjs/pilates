/**
 * Edge identifiers for setters that target one or more sides of a box
 * (padding, margin, position).
 *
 * `All` writes to top + right + bottom + left.
 * `Horizontal` writes to left + right.
 * `Vertical` writes to top + bottom.
 *
 * Implemented as a frozen const-object rather than `enum` so that
 * `verbatimModuleSyntax` works smoothly and tree-shaking sees plain
 * numeric literals.
 */

export const Edge = {
  Top: 0,
  Right: 1,
  Bottom: 2,
  Left: 3,
  Horizontal: 4,
  Vertical: 5,
  All: 6,
} as const;

export type Edge = (typeof Edge)[keyof typeof Edge];
