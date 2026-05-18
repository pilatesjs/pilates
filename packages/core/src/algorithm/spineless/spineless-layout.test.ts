/**
 * Differential tests for `SpinelessLayout` (phase 8, v19): the
 * Spineless layout driver vs the imperative `calculateLayout`.
 *
 * Each tree is laid out by both engines and every node's `layout`
 * (`left` / `top` / `width` / `height`) plus `scrollWidth` /
 * `scrollHeight` is asserted byte-identical. Trees are kept
 * integer-friendly so rounding is unambiguous — the grammar and the
 * imperative agree on the float layout to within ULPs, and only an
 * exact `x.5` cell boundary could round them apart (see the phase-7
 * spec). The fuzzers cover the random-tree surface.
 */

import { describe, expect, it } from 'vitest';
import { Edge } from '../../edge.js';
import { Node } from '../../node.js';
import { SpinelessLayout } from './layout.js';

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
  scrollWidth: number;
  scrollHeight: number;
}

function snapshot(root: Node): Box[] {
  const out: Box[] = [];
  function visit(n: Node): void {
    out.push({
      left: n.layout.left,
      top: n.layout.top,
      width: n.layout.width,
      height: n.layout.height,
      scrollWidth: n.layout.scrollWidth,
      scrollHeight: n.layout.scrollHeight,
    });
    for (let i = 0; i < n.getChildCount(); i++) visit(n.getChild(i)!);
  }
  visit(root);
  return out;
}

/**
 * Build the tree twice — one laid out by `SpinelessLayout`, one by
 * imperative `calculateLayout` — and assert the two layouts match.
 */
function sameLayout(make: () => Node, availableWidth?: number, availableHeight?: number): void {
  const viaSpineless = make();
  new SpinelessLayout(viaSpineless).layout(availableWidth, availableHeight);

  const viaImperative = make();
  viaImperative.calculateLayout(availableWidth, availableHeight);

  expect(snapshot(viaSpineless)).toEqual(snapshot(viaImperative));
}

describe('SpinelessLayout — differential vs calculateLayout (slice v19)', () => {
  it('a fixed-size row', () => {
    sameLayout(() => {
      const root = Node.create();
      root.setWidth(200);
      root.setHeight(40);
      root.setFlexDirection('row');
      for (const w of [30, 50, 20]) {
        const c = Node.create();
        c.setWidth(w);
        c.setHeight(30);
        root.insertChild(c, root.getChildCount());
      }
      return root;
    });
  });

  it('flex-grow distribution', () => {
    sameLayout(() => {
      const root = Node.create();
      root.setWidth(300);
      root.setHeight(40);
      root.setFlexDirection('row');
      for (let i = 0; i < 3; i++) {
        const c = Node.create();
        c.setWidth(20);
        c.setHeight(30);
        c.setFlexGrow(i + 1);
        root.insertChild(c, i);
      }
      return root;
    });
  });

  it('flex-shrink with numeric basis', () => {
    sameLayout(() => {
      const root = Node.create();
      root.setWidth(120);
      root.setHeight(40);
      root.setFlexDirection('row');
      for (let i = 0; i < 3; i++) {
        const c = Node.create();
        c.setWidth(0);
        c.setHeight(30);
        c.setFlexBasis(60);
        c.setFlexShrink(1);
        root.insertChild(c, i);
      }
      return root;
    });
  });

  it('column with padding, gap and margins', () => {
    sameLayout(() => {
      const root = Node.create();
      root.setWidth(100);
      root.setHeight(200);
      root.setFlexDirection('column');
      root.setPadding(Edge.Top, 10);
      root.setPadding(Edge.Left, 6);
      root.setGap('row', 8);
      for (let i = 0; i < 3; i++) {
        const c = Node.create();
        c.setWidth(40);
        c.setHeight(30);
        c.setMargin(Edge.Top, 4);
        root.insertChild(c, i);
      }
      return root;
    });
  });

  it('justify-content + align-items', () => {
    sameLayout(() => {
      const root = Node.create();
      root.setWidth(240);
      root.setHeight(80);
      root.setFlexDirection('row');
      root.setJustifyContent('space-between');
      root.setAlignItems('center');
      for (let i = 0; i < 3; i++) {
        const c = Node.create();
        c.setWidth(40);
        c.setHeight(20);
        root.insertChild(c, i);
      }
      return root;
    });
  });

  it('a multi-line wrap container', () => {
    sameLayout(() => {
      const root = Node.create();
      root.setWidth(150);
      root.setHeight(120);
      root.setFlexDirection('row');
      root.setFlexWrap('wrap');
      for (let i = 0; i < 4; i++) {
        const c = Node.create();
        c.setWidth(60);
        c.setHeight(30);
        root.insertChild(c, i);
      }
      return root;
    });
  });

  it("an 'auto' root sized from available", () => {
    sameLayout(
      () => {
        const root = Node.create();
        const c = Node.create();
        c.setWidth(40);
        c.setHeight(40);
        root.insertChild(c, 0);
        return root;
      },
      120,
      90,
    );
  });

  it("an 'auto' cross size stretches under align-items: stretch", () => {
    sameLayout(() => {
      const root = Node.create();
      root.setWidth(100);
      root.setHeight(100);
      const c = Node.create();
      c.setHeight(20); // width 'auto' → stretches to 100
      root.insertChild(c, 0);
      return root;
    });
  });

  it('aspectRatio derivation', () => {
    sameLayout(() => {
      const root = Node.create();
      root.setWidth(200);
      root.setHeight(200);
      const c = Node.create();
      c.setWidth(60); // height 'auto', ratio 2 → 30
      c.setAspectRatio(2);
      root.insertChild(c, 0);
      return root;
    });
  });

  it('a measure-function leaf', () => {
    sameLayout(() => {
      const root = Node.create();
      root.setWidth(100);
      root.setHeight(100);
      const leaf = Node.create();
      leaf.setWidth(40); // explicit cross; height measured
      leaf.setMeasureFunc(() => ({ width: 40, height: 26 }));
      root.insertChild(leaf, 0);
      return root;
    });
  });

  it('absolute positioning', () => {
    sameLayout(() => {
      const root = Node.create();
      root.setWidth(120);
      root.setHeight(120);
      root.setFlexDirection('row');
      const a = Node.create();
      a.setWidth(40);
      a.setHeight(40);
      root.insertChild(a, 0);
      const abs = Node.create();
      abs.setPositionType('absolute');
      abs.setWidth(20);
      abs.setHeight(15);
      abs.setPosition(Edge.Right, 8);
      abs.setPosition(Edge.Top, 6);
      root.insertChild(abs, 1);
      return root;
    });
  });

  it('min / max clamping', () => {
    sameLayout(() => {
      const root = Node.create();
      root.setWidth(300);
      root.setHeight(40);
      root.setFlexDirection('row');
      for (let i = 0; i < 3; i++) {
        const c = Node.create();
        c.setWidth(20);
        c.setHeight(20);
        c.setFlexGrow(1);
        c.setMaxWidth(60);
        root.insertChild(c, i);
      }
      return root;
    });
  });

  it('a reverse direction', () => {
    sameLayout(() => {
      const root = Node.create();
      root.setWidth(200);
      root.setHeight(40);
      root.setFlexDirection('row-reverse');
      for (const w of [30, 40, 50]) {
        const c = Node.create();
        c.setWidth(w);
        c.setHeight(30);
        root.insertChild(c, root.getChildCount());
      }
      return root;
    });
  });

  it('a nested column-of-rows tree', () => {
    sameLayout(() => {
      const root = Node.create();
      root.setWidth(120);
      root.setHeight(120);
      root.setFlexDirection('column');
      for (let i = 0; i < 2; i++) {
        const row = Node.create();
        row.setWidth(120);
        row.setHeight(60);
        row.setFlexDirection('row');
        root.insertChild(row, i);
        for (let j = 0; j < 2; j++) {
          const leaf = Node.create();
          leaf.setWidth(50);
          leaf.setHeight(40);
          row.insertChild(leaf, j);
        }
      }
      return root;
    });
  });
});

describe('SpinelessLayout — persistent runtime + incremental relayout (slice v20)', () => {
  /**
   * Drive a persistent `SpinelessLayout` through a mutation sequence,
   * applying each step to a parallel imperative tree, and assert the
   * two layouts match after every step. Returns the driver so the
   * caller can inspect `stats`.
   */
  function checkSequence(
    make: () => Node,
    steps: Array<(root: Node) => void>,
    availableWidth?: number,
    availableHeight?: number,
  ): SpinelessLayout {
    const slTree = make();
    const impTree = make();
    const sl = new SpinelessLayout(slTree);

    sl.layout(availableWidth, availableHeight);
    impTree.calculateLayout(availableWidth, availableHeight);
    expect(snapshot(slTree)).toEqual(snapshot(impTree));

    for (const step of steps) {
      step(slTree);
      step(impTree);
      sl.layout(availableWidth, availableHeight);
      impTree.calculateLayout(availableWidth, availableHeight);
      expect(snapshot(slTree)).toEqual(snapshot(impTree));
    }
    return sl;
  }

  const fixedRow = (): Node => {
    const root = Node.create();
    root.setWidth(200);
    root.setHeight(40);
    root.setFlexDirection('row');
    for (let i = 0; i < 3; i++) {
      const c = Node.create();
      c.setWidth(40);
      c.setHeight(30);
      root.insertChild(c, i);
    }
    return root;
  };

  it('a value mutation takes the incremental path', () => {
    const sl = checkSequence(fixedRow, [(r) => r.getChild(1)!.setWidth(70)]);
    expect(sl.stats).toEqual({ fullBuilds: 1, incrementalRelayouts: 1, graftRelayouts: 0 });
  });

  it('a sequence of value mutations all stay incremental', () => {
    const sl = checkSequence(fixedRow, [
      (r) => r.getChild(0)!.setWidth(55),
      (r) => r.getChild(2)!.setHeight(20),
      (r) => r.setWidth(260),
      (r) => r.getChild(1)!.setWidth(10),
    ]);
    expect(sl.stats).toEqual({ fullBuilds: 1, incrementalRelayouts: 4, graftRelayouts: 0 });
  });

  it('gap / padding / margin / min / max mutations stay incremental', () => {
    const sl = checkSequence(fixedRow, [
      (r) => r.setGap('column', 6),
      (r) => r.setPadding(Edge.Left, 9),
      (r) => r.getChild(0)!.setMargin(Edge.Right, 5),
      (r) => r.getChild(1)!.setMinWidth(80),
      (r) => r.getChild(2)!.setMaxWidth(15),
    ]);
    expect(sl.stats).toEqual({ fullBuilds: 1, incrementalRelayouts: 5, graftRelayouts: 0 });
  });

  it('a positive→positive flex-weight tweak stays incremental', () => {
    const sl = checkSequence(() => {
      const root = Node.create();
      root.setWidth(300);
      root.setHeight(40);
      root.setFlexDirection('row');
      for (let i = 0; i < 3; i++) {
        const c = Node.create();
        c.setWidth(20);
        c.setHeight(30);
        c.setFlexGrow(1);
        root.insertChild(c, i);
      }
      return root;
    }, [(r) => r.getChild(0)!.setFlexGrow(3)]);
    expect(sl.stats).toEqual({ fullBuilds: 1, incrementalRelayouts: 1, graftRelayouts: 0 });
  });

  it("an 'auto' root re-sized from a new available stays incremental", () => {
    const make = (): Node => {
      const root = Node.create(); // both axes 'auto'
      const c = Node.create();
      c.setWidth(20);
      c.setHeight(20);
      root.insertChild(c, 0);
      return root;
    };
    const slTree = make();
    const sl = new SpinelessLayout(slTree);
    const impTree = make();

    sl.layout(100, 80);
    impTree.calculateLayout(100, 80);
    expect(snapshot(slTree)).toEqual(snapshot(impTree));

    // A new available — same PRESENCE — feeds the `available:*`
    // input Fields, so it relays incrementally.
    sl.layout(140, 90);
    impTree.calculateLayout(140, 90);
    expect(snapshot(slTree)).toEqual(snapshot(impTree));

    expect(sl.stats).toEqual({ fullBuilds: 1, incrementalRelayouts: 1, graftRelayouts: 0 });
  });

  it('an available presence change forces a rebuild', () => {
    const slTree = (() => {
      const root = Node.create();
      const c = Node.create();
      c.setWidth(20);
      c.setHeight(20);
      root.insertChild(c, 0);
      return root;
    })();
    const sl = new SpinelessLayout(slTree);
    sl.layout(100, 80);
    sl.layout(undefined, undefined); // width/height availability dropped
    expect(sl.stats.fullBuilds).toBe(2);
  });

  it('a flex-direction change forces a rebuild and stays correct', () => {
    const sl = checkSequence(fixedRow, [(r) => r.setFlexDirection('column')]);
    expect(sl.stats).toEqual({ fullBuilds: 2, incrementalRelayouts: 0, graftRelayouts: 0 });
  });

  it('a flex weight crossing zero forces a rebuild', () => {
    const sl = checkSequence(fixedRow, [(r) => r.getChild(0)!.setFlexGrow(1)]);
    expect(sl.stats.fullBuilds).toBe(2);
  });

  it("a width crossing the 'auto' boundary forces a rebuild", () => {
    const sl = checkSequence(fixedRow, [(r) => r.getChild(0)!.setWidth('auto' as never)]);
    expect(sl.stats.fullBuilds).toBe(2);
  });

  it('removing a child forces a rebuild and stays correct', () => {
    const sl = checkSequence(fixedRow, [(r) => r.removeChild(r.getChild(2)!)]);
    expect(sl.stats.fullBuilds).toBe(2);
  });

  it('an aspectRatio change forces a rebuild', () => {
    const sl = checkSequence(() => {
      const root = Node.create();
      root.setWidth(200);
      root.setHeight(200);
      const c = Node.create();
      c.setWidth(60);
      c.setAspectRatio(2);
      root.insertChild(c, 0);
      return root;
    }, [(r) => r.getChild(0)!.setAspectRatio(3)]);
    expect(sl.stats.fullBuilds).toBe(2);
  });

  it('a mixed value / structural / value sequence stays correct throughout', () => {
    checkSequence(fixedRow, [
      (r) => r.getChild(0)!.setWidth(60), // value → incremental
      (r) => r.setFlexDirection('column'), // structural → rebuild
      (r) => r.getChild(1)!.setHeight(12), // value → incremental
      (r) => {
        const c = Node.create(); // mid-list insert → rebuild
        c.setWidth(30);
        c.setHeight(18);
        r.insertChild(c, 0);
      },
      (r) => r.setGap('row', 4), // value → incremental
    ]);
  });
});

describe('SpinelessLayout — graft fast-path for child append (slice v21)', () => {
  function checkSequence(make: () => Node, steps: Array<(root: Node) => void>): SpinelessLayout {
    const slTree = make();
    const impTree = make();
    const sl = new SpinelessLayout(slTree);
    sl.layout();
    impTree.calculateLayout();
    expect(snapshot(slTree)).toEqual(snapshot(impTree));
    for (const step of steps) {
      step(slTree);
      step(impTree);
      sl.layout();
      impTree.calculateLayout();
      expect(snapshot(slTree)).toEqual(snapshot(impTree));
    }
    return sl;
  }

  const fixedRow = (): Node => {
    const root = Node.create();
    root.setWidth(240);
    root.setHeight(40);
    root.setFlexDirection('row');
    for (let i = 0; i < 3; i++) {
      const c = Node.create();
      c.setWidth(40);
      c.setHeight(30);
      root.insertChild(c, i);
    }
    return root;
  };

  const appendLeaf = (w: number, h: number) => (r: Node) => {
    const c = Node.create();
    c.setWidth(w);
    c.setHeight(h);
    r.insertChild(c, r.getChildCount());
  };

  it('appending a last child takes the graft fast-path', () => {
    const sl = checkSequence(fixedRow, [appendLeaf(50, 25)]);
    expect(sl.stats).toEqual({ fullBuilds: 1, incrementalRelayouts: 0, graftRelayouts: 1 });
  });

  it('several sequential appends each graft', () => {
    const sl = checkSequence(fixedRow, [
      appendLeaf(20, 20),
      appendLeaf(30, 24),
      appendLeaf(10, 18),
    ]);
    expect(sl.stats).toEqual({ fullBuilds: 1, incrementalRelayouts: 0, graftRelayouts: 3 });
  });

  it('appending a whole subtree grafts in one shot', () => {
    const sl = checkSequence(fixedRow, [
      (r) => {
        const box = Node.create();
        box.setWidth(60);
        box.setHeight(36);
        box.setFlexDirection('column');
        for (let i = 0; i < 2; i++) {
          const leaf = Node.create();
          leaf.setWidth(60);
          leaf.setHeight(15);
          box.insertChild(leaf, i);
        }
        r.insertChild(box, r.getChildCount());
      },
    ]);
    expect(sl.stats.graftRelayouts).toBe(1);
  });

  it('appending into a flex-distributing parent grafts (rebinds the siblings)', () => {
    const sl = checkSequence(() => {
      const root = Node.create();
      root.setWidth(300);
      root.setHeight(40);
      root.setFlexDirection('row');
      for (let i = 0; i < 2; i++) {
        const c = Node.create();
        c.setWidth(20);
        c.setHeight(30);
        c.setFlexGrow(1);
        root.insertChild(c, i);
      }
      return root;
    }, [
      (r) => {
        const c = Node.create();
        c.setWidth(20);
        c.setHeight(30);
        c.setFlexGrow(1);
        r.insertChild(c, r.getChildCount());
      },
    ]);
    expect(sl.stats.graftRelayouts).toBe(1);
  });

  it('appending into a wrap container grafts', () => {
    const sl = checkSequence(() => {
      const root = Node.create();
      root.setWidth(150);
      root.setHeight(120);
      root.setFlexDirection('row');
      root.setFlexWrap('wrap');
      for (let i = 0; i < 2; i++) {
        const c = Node.create();
        c.setWidth(60);
        c.setHeight(30);
        root.insertChild(c, i);
      }
      return root;
    }, [appendLeaf(60, 30)]);
    expect(sl.stats.graftRelayouts).toBe(1);
  });

  it('an append composed with a value mutation grafts and applies both', () => {
    const sl = checkSequence(fixedRow, [
      (r) => {
        appendLeaf(50, 25)(r);
        r.getChild(0)!.setWidth(70);
      },
    ]);
    expect(sl.stats.graftRelayouts).toBe(1);
  });

  it('a mid-list insert is not a graft — full rebuild', () => {
    const sl = checkSequence(fixedRow, [
      (r) => {
        const c = Node.create();
        c.setWidth(25);
        c.setHeight(30);
        r.insertChild(c, 0); // not the last child
      },
    ]);
    expect(sl.stats.fullBuilds).toBe(2);
    expect(sl.stats.graftRelayouts).toBe(0);
  });

  it('appending to a reverse-direction parent falls back to a rebuild', () => {
    const sl = checkSequence(() => {
      const root = Node.create();
      root.setWidth(240);
      root.setHeight(40);
      root.setFlexDirection('row-reverse');
      for (let i = 0; i < 2; i++) {
        const c = Node.create();
        c.setWidth(40);
        c.setHeight(30);
        root.insertChild(c, i);
      }
      return root;
    }, [appendLeaf(40, 30)]);
    expect(sl.stats.fullBuilds).toBe(2);
    expect(sl.stats.graftRelayouts).toBe(0);
  });

  it('a remove is not a graft — full rebuild', () => {
    const sl = checkSequence(fixedRow, [(r) => r.removeChild(r.getChild(2)!)]);
    expect(sl.stats.fullBuilds).toBe(2);
    expect(sl.stats.graftRelayouts).toBe(0);
  });

  it('an append then a value relayout then another append', () => {
    const sl = checkSequence(fixedRow, [
      appendLeaf(30, 22),
      (r) => r.getChild(1)!.setWidth(55),
      appendLeaf(15, 18),
    ]);
    expect(sl.stats).toEqual({ fullBuilds: 1, incrementalRelayouts: 1, graftRelayouts: 2 });
  });
});

describe('SpinelessLayout — incremental output write-back (slice v23)', () => {
  function checkSequence(make: () => Node, steps: Array<(root: Node) => void>): void {
    const slTree = make();
    const impTree = make();
    const sl = new SpinelessLayout(slTree);
    sl.layout();
    impTree.calculateLayout();
    expect(snapshot(slTree)).toEqual(snapshot(impTree));
    for (const step of steps) {
      step(slTree);
      step(impTree);
      sl.layout();
      impTree.calculateLayout();
      expect(snapshot(slTree)).toEqual(snapshot(impTree));
    }
  }

  // A depth-4 nested tree: root → col → row → cell.
  const deepTree = (): Node => {
    const root = Node.create();
    root.setWidth(240);
    root.setHeight(200);
    root.setFlexDirection('column');
    for (let c = 0; c < 2; c++) {
      const col = Node.create();
      col.setWidth(240);
      col.setHeight(90);
      col.setFlexDirection('column');
      root.insertChild(col, c);
      for (let r = 0; r < 2; r++) {
        const row = Node.create();
        row.setWidth(240);
        row.setHeight(40);
        row.setFlexDirection('row');
        col.insertChild(row, r);
        for (let i = 0; i < 3; i++) {
          const cell = Node.create();
          cell.setWidth(60);
          cell.setHeight(30);
          row.insertChild(cell, i);
        }
      }
    }
    return root;
  };

  const cell = (root: Node, c: number, r: number, i: number): Node =>
    root.getChild(c)!.getChild(r)!.getChild(i)!;

  it('a deep leaf width mutation re-rounds only its subtree', () => {
    checkSequence(deepTree, [(root) => cell(root, 1, 0, 1)!.setHeight(12)]);
  });

  it('a deep leaf width mutation shifts its later siblings', () => {
    checkSequence(deepTree, [(root) => cell(root, 0, 1, 0)!.setWidth(90)]);
  });

  it('resizing a mid-tree row re-rounds the row subtree', () => {
    checkSequence(deepTree, [(root) => root.getChild(0)!.getChild(1)!.setHeight(64)]);
  });

  it('scattered mutations in different subtrees each relayout', () => {
    checkSequence(deepTree, [
      (root) => {
        cell(root, 0, 0, 0)!.setWidth(20);
        cell(root, 1, 1, 2)!.setHeight(10);
      },
    ]);
  });

  it('a long value-mutation sequence on a deep tree stays correct', () => {
    checkSequence(deepTree, [
      (root) => cell(root, 0, 0, 1)!.setWidth(30),
      (root) => root.getChild(1)!.setHeight(70),
      (root) => cell(root, 1, 0, 0)!.setHeight(8),
      (root) => cell(root, 0, 1, 2)!.setWidth(100),
      (root) => root.getChild(0)!.getChild(0)!.setHeight(36),
    ]);
  });

  it('fractional flex-grow layout stays correct under incremental relayout', () => {
    checkSequence(() => {
      const root = Node.create();
      root.setWidth(100);
      root.setHeight(40);
      root.setFlexDirection('row');
      for (let i = 0; i < 3; i++) {
        const c = Node.create();
        c.setWidth(0);
        c.setHeight(30);
        c.setFlexGrow(1); // 100 / 3 — fractional
        root.insertChild(c, i);
      }
      return root;
    }, [
      (root) => root.setWidth(160),
      (root) => root.getChild(1)!.setFlexGrow(2),
      (root) => root.setWidth(101),
    ]);
  });

  it('an available resize re-rounds the whole tree', () => {
    const slTree = (() => {
      const root = Node.create(); // 'auto' root
      root.setFlexDirection('column');
      for (let i = 0; i < 3; i++) {
        const c = Node.create();
        c.setWidth(40);
        c.setHeight(20);
        root.insertChild(c, i);
      }
      return root;
    })();
    const sl = new SpinelessLayout(slTree);
    const impTree = (() => {
      const root = Node.create();
      root.setFlexDirection('column');
      for (let i = 0; i < 3; i++) {
        const c = Node.create();
        c.setWidth(40);
        c.setHeight(20);
        root.insertChild(c, i);
      }
      return root;
    })();
    sl.layout(120, 90);
    impTree.calculateLayout(120, 90);
    expect(snapshot(slTree)).toEqual(snapshot(impTree));
    sl.layout(150, 70);
    impTree.calculateLayout(150, 70);
    expect(snapshot(slTree)).toEqual(snapshot(impTree));
  });
});

describe('SpinelessLayout — per-call layout trace (slice v26)', () => {
  const fixedRow = (): Node => {
    const root = Node.create();
    root.setWidth(240);
    root.setHeight(40);
    root.setFlexDirection('row');
    for (let i = 0; i < 3; i++) {
      const c = Node.create();
      c.setWidth(40);
      c.setHeight(30);
      root.insertChild(c, i);
    }
    return root;
  };

  it('lastTrace is null before the first layout()', () => {
    const sl = new SpinelessLayout(fixedRow());
    expect(sl.lastTrace).toBeNull();
  });

  it('the first layout() reports a build', () => {
    const sl = new SpinelessLayout(fixedRow());
    sl.layout();
    expect(sl.lastTrace).toEqual({
      path: 'build',
      dirtyNodes: 0,
      fieldsRecomputed: 0,
      fieldsChanged: 0,
      movedSubtrees: 0,
    });
  });

  it('a value mutation reports an incremental relayout', () => {
    const root = fixedRow();
    const sl = new SpinelessLayout(root);
    sl.layout();
    root.getChild(0)!.setWidth(80);
    sl.layout();
    const t = sl.lastTrace!;
    expect(t.path).toBe('incremental');
    // `markDirty` on the setter path propagates `_dirty` up the
    // ancestor chain, so the dirty region is the leaf + the root.
    expect(t.dirtyNodes).toBe(2);
    expect(t.fieldsChanged).toBeGreaterThanOrEqual(1);
    expect(t.fieldsRecomputed).toBeGreaterThanOrEqual(t.fieldsChanged);
    expect(t.movedSubtrees).toBeGreaterThanOrEqual(1); // the leaf + shifted siblings
  });

  it('a no-op mutation reports an incremental relayout that changes nothing', () => {
    const root = fixedRow();
    const sl = new SpinelessLayout(root);
    sl.layout();
    root.getChild(0)!.setWidth(40); // already 40 — nothing actually moves
    sl.layout();
    const t = sl.lastTrace!;
    expect(t.path).toBe('incremental');
    expect(t.fieldsChanged).toBe(0);
    expect(t.movedSubtrees).toBe(0);
  });

  it('a child append reports a graft', () => {
    const root = fixedRow();
    const sl = new SpinelessLayout(root);
    sl.layout();
    const c = Node.create();
    c.setWidth(40);
    c.setHeight(30);
    root.insertChild(c, root.getChildCount());
    sl.layout();
    expect(sl.lastTrace!.path).toBe('graft');
  });

  it('a flex-direction flip reports a rebuild', () => {
    const root = fixedRow();
    const sl = new SpinelessLayout(root);
    sl.layout();
    root.setFlexDirection('column');
    sl.layout();
    expect(sl.lastTrace!.path).toBe('build');
  });
});
