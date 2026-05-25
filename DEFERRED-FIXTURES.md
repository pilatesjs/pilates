# Deferred Fixtures

Fixtures here were authored but not committed because the two reference engines
(Pilates and Yoga) disagree on the expected layout. Per the Phase 3.1
fixture-corpus authoring discipline: **engines disagree → defer** (do not commit
the fixture; file an issue tracking the divergence instead).

---

## position-edges — relative position offsets (Pilates missing feature)

**Tracking issue**: [#150](https://github.com/pilatesjs/pilates/issues/150)

**Root cause**: Pilates does not apply `position` edge offsets for
`positionType: relative` nodes. Yoga 3.x does honor them (relative offsets
shift the node's painted position without affecting the flow of siblings).
This is a feature gap, not a philosophy difference.

### Deferred fixture: `position-edges/relative-offset-top-left`

Child width=10, height=5 with `positionTop=2, positionLeft=3` inside a row
40×10.

| Engine  | kid left | kid top |
|---------|----------|---------|
| Yoga    | 3        | 2       |
| Pilates | 0        | 0       |

Expected (Yoga): `{ left: 3, top: 2, width: 10, height: 5 }`

### Deferred fixture: `position-edges/relative-offset-bottom`

Child width=10, height=5 with `positionBottom=2` inside a row 40×10.
`positionBottom=2` on a relative node is equivalent to `top: -2`.

| Engine  | kid left | kid top |
|---------|----------|---------|
| Yoga    | 0        | -2      |
| Pilates | 0        | 0       |

Expected (Yoga): `{ left: 0, top: -2, width: 10, height: 5 }`

### Deferred fixture: `position-edges/multiple-relative-children`

Row 40×10, two children width=10 each; child `b` has `positionLeft=5`.
Flow position of `b` = 10; `+5` offset → 15.

| Engine  | b left |
|---------|--------|
| Yoga    | 15     |
| Pilates | 10     |

Expected (Yoga): `b: { left: 15, top: 0, width: 10, height: 5 }`

### Recommended fix

Implement relative-position-offset application in Pilates' layout pass
(analogous to Yoga's `applyRelativePositionedLayoutToChild`). Once fixed,
these three fixtures can be reinstated by restoring the spec files from this
document and re-running `pnpm test packages/core/test/fixtures.test.ts`.

---

*Last updated: 2026-05-25 — Task 10 of Phase 3.1 yoga-fixture-corpus plan.*
