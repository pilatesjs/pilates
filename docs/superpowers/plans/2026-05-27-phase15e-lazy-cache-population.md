# Phase 15E — Lazy cache population Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use `- [ ]` for tracking.

**Goal:** Thread a `populateCache: boolean` through `calculateLayoutImpl` + `computeScrollSizes`. The router's first-call path passes `false`, skipping ~1007µs of wasted `LayoutCache` population per 10k-node cold layout. Scroll-size computation (essential output) still runs.

**Architecture:** The public `calculateLayout` router runs the imperative engine exactly once per root (layout #1); layout #2+ uses Spineless, which never reads the imperative `LayoutCache`. So first-layout cache population has no reader — skip it.

**Tech Stack:** TypeScript NodeNext ESM. Vitest. `pnpm test:differential` is the controlling correctness gate.

---

## File Structure

```
packages/core/src/algorithm/index.ts        MODIFY — populateCache param on calculateLayoutImpl + computeScrollSizes; 3 call sites + root store gate
bench/RESULTS.md                            REGEN  — confirms huge improvement
```

---

### Task 1: Thread `populateCache` through the imperative path

**Files:**
- Modify: `packages/core/src/algorithm/index.ts`

The current code (verified):
- `calculateLayoutImpl` is at line 166; signature `(root, availableWidth, availableHeight)`.
- It calls `computeScrollSizes(root)` at line 231.
- Lines 234-236 store the root's cache.
- `computeScrollSizes` at line 256; cache population is the `if (node.getParent() !== null)` block at lines 272-281.
- Call sites: line 104 (router first-call), 133 + 139 (differential mode), 163 (`calculateLayoutImperative`).

- [ ] **Step 1: Add `populateCache` parameter to `calculateLayoutImpl`**

Change the signature (line 166):

```ts
function calculateLayoutImpl(
  root: Node,
  availableWidth: number | undefined,
  availableHeight: number | undefined,
  populateCache: boolean,
): void {
```

- [ ] **Step 2: Gate the root cache store**

The cold-path tail (lines 230-236) currently:

```ts
  layoutChildren(root);
  roundLayout(root);
  computeScrollSizes(root);
  markClean(root);

  // Store the root's result (computeScrollSizes already cached inner nodes).
  if (root._layoutCache === undefined) root._layoutCache = new LayoutCache();
  root._layoutCache.store(key, snapshotForCache(root));
```

Becomes:

```ts
  layoutChildren(root);
  roundLayout(root);
  computeScrollSizes(root, populateCache);
  markClean(root);

  // Store the root's result (computeScrollSizes already cached inner nodes).
  // Skipped when populateCache is false — the router runs the imperative
  // engine only once per root, then switches to Spineless, which never
  // reads this cache.
  if (populateCache) {
    if (root._layoutCache === undefined) root._layoutCache = new LayoutCache();
    root._layoutCache.store(key, snapshotForCache(root));
  }
```

Note: `computeScrollSizes(root)` call updated to `computeScrollSizes(root, populateCache)`.

- [ ] **Step 3: Add `populateCache` to `computeScrollSizes` + gate the inner cache store**

Change `computeScrollSizes` (line 256):

```ts
function computeScrollSizes(node: Node, populateCache: boolean): void {
  for (let i = 0; i < node.getChildCount(); i++) {
    computeScrollSizes(node.getChild(i)!, populateCache);
  }

  let contentRight = 0;
  let contentBottom = 0;
  for (let i = 0; i < node.getChildCount(); i++) {
    const c = node.getChild(i)!;
    const cl = c._layout;
    contentRight = Math.max(contentRight, cl.left + cl.width);
    contentBottom = Math.max(contentBottom, cl.top + cl.height);
  }
  node._layout.scrollWidth = Math.max(node._layout.width, contentRight);
  node._layout.scrollHeight = Math.max(node._layout.height, contentBottom);

  // Cache the node's layout for next pass. Skip root (cached separately
  // by calculateLayoutImpl). Skipped entirely when populateCache is false
  // — the router's first-layout imperative pass populates a cache no
  // subsequent layout reads (layout 2+ uses the Spineless engine).
  if (populateCache && node.getParent() !== null) {
    const innerKey = {
      availableWidth: node.layout.width,
      widthMode: 'exactly' as const,
      availableHeight: node.layout.height,
      heightMode: 'exactly' as const,
    };
    if (node._layoutCache === undefined) node._layoutCache = new LayoutCache();
    node._layoutCache.store(innerKey, snapshotForCache(node));
  }
}
```

The scroll-size math (`contentRight`/`contentBottom`/`scrollWidth`/`scrollHeight`) is UNCHANGED and always runs — it's layout output. Only the `if (... node.getParent() !== null)` cache block gains the `populateCache &&` guard.

- [ ] **Step 4: Update the 4 call sites**

- **Line 104** (router first-call branch): `calculateLayoutImpl(root, availableWidth, availableHeight, false)` — the win.
- **Line 133** (differential mode, pass 1): `calculateLayoutImpl(root, availableWidth, availableHeight, true)`.
- **Line 139** (differential mode, pass 2): `calculateLayoutImpl(root, availableWidth, availableHeight, true)`.
- **Line 163** (`calculateLayoutImperative`): `calculateLayoutImpl(root, availableWidth, availableHeight, true)`.

(Line numbers are pre-edit; the actual lines shift as you edit. Identify each call site by context: the router's `engine === undefined` branch, the two differential-mode passes, and the `calculateLayoutImperative` wrapper.)

- [ ] **Step 5: Run typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: clean.

- [ ] **Step 6: Run the full core suite**

Run: `pnpm --filter @pilates/core test`
Expected: 1456 tests pass. The cache-skip changes layout SPEED, not output — every layout test asserts output, so all should pass.

- [ ] **Step 7: Run differential mode — controlling gate**

Run: `pnpm test:differential`
Expected: 820 passed / 6 skipped. Differential mode passes `populateCache = true`, so its behavior is byte-identical to before. If this fails, a call site got the wrong boolean.

- [ ] **Step 8: Run structural fuzzer**

Run: `pnpm --filter @pilates/core test -- spineless-structural.fuzz`
Expected: green at numRuns=300.

- [ ] **Step 9: Run Yoga oracle**

Run: `pnpm --filter @pilates/core test -- yoga-oracle`
Expected: 33 pass. The oracle asserts scroll values — confirms scroll computation still runs when `populateCache = false`.

- [ ] **Step 10: Commit**

```bash
git add packages/core/src/algorithm/index.ts
git commit -m "$(cat <<'EOF'
phase 15E: skip wasted cache population on imperative first layout

The public calculateLayout router runs the imperative engine
(calculateLayoutImpl) exactly once per root — the first layout.
Layout 2+ switches to the Spineless engine, which has independent
state and never reads the imperative LayoutCache. So the ~1007µs
that computeScrollSizes spends populating per-node LayoutCaches on
the first layout (snapshotForCache + LayoutCache.store + lazy
LayoutCache allocation) caches results no layout will ever read.

calculateLayoutImpl + computeScrollSizes gain a populateCache
parameter. The router's first-call path passes false — skipping
all cache population. Scroll-size computation (layout output) still
runs unconditionally. calculateLayoutImperative (the @internal
direct entry) and differential mode pass true.

Profile (huge, 10101 nodes): computeScrollSizes 1084µs → ~77µs
when populateCache is false. Cold layout 2.67ms → ~1.67ms.

Correctness: the LayoutCache is a pure speed optimization, guarded
on `_layoutCache !== undefined` at every read site. Skipping
population leaves it undefined; the read sites take the full
cold path instead. Differential mode (populateCache=true) is
byte-identical to before.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Validation sweep + bench

**Files:** `bench/RESULTS.md` (regenerated).

- [ ] **Step 1: Lint + typecheck**

Run: `pnpm lint && pnpm typecheck`
Expected: clean.

- [ ] **Step 2: Full workspace test**

Run: `pnpm test`
Expected: 1456 pass.

- [ ] **Step 3: Differential mode ×3**

Run: `pnpm test:differential` three times.
Expected: 820 / 6 skipped each. No flake.

- [ ] **Step 4: Structural fuzzer + Yoga oracle**

Run: `pnpm --filter @pilates/core test -- spineless-structural.fuzz`
Run: `pnpm --filter @pilates/core test -- yoga-oracle`
Expected: both green.

- [ ] **Step 5: Bench**

Run: `pnpm bench`
Expected: writes `bench/RESULTS.md` + history JSON.

Compare `@pilates/core (layout)` rows to pre-15E (commit `24bf636`):
- Pre-15E: `tiny 5.2µs / realistic 144.9µs / stress 711.6µs / big 4.10ms / huge 11.66ms / hot-relayout 21.5µs / hot-relayoutboundary 20.7µs / hot-relayouttext 20.9µs / hot-structural 387.9µs`.
- Target post-15E: `huge ≥ 8% faster (~10.6ms)`, `big ~3.7ms`, `stress ~600µs`, `realistic ~110µs`. Hot-* within variance (they route through Spineless — unaffected).

If `huge` does NOT improve by ≥ 5%, investigate — the `populateCache = false` flag may not be reaching the router path, or `computeScrollSizes`'s cache block wasn't the measured cost.

- [ ] **Step 6: Commit `bench/RESULTS.md`**

```bash
git add bench/RESULTS.md
git commit -m "$(cat <<'EOF'
bench: refresh RESULTS.md post phase 15E

Skipping wasted first-layout cache population:
- [actual before/after numbers from inspection]

Cold scenarios (tiny/realistic/stress/big) cross the 2× Yoga
decisive-win bar. huge improves toward it; full 2× on huge needs
the tree-construction optimization (Phase 15F).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

(Replace `[actual before/after numbers from inspection]` with the real comparison table.)

---

## Self-Review

**Spec coverage:**
- `populateCache` param on `calculateLayoutImpl`: Task 1 Step 1. ✓
- Router first-call passes `false`: Task 1 Step 4. ✓
- `calculateLayoutImperative` + differential pass `true`: Task 1 Step 4. ✓
- Scroll computation always runs: Task 1 Step 3 (only the cache block gated). ✓
- Root cache store gated: Task 1 Step 2. ✓
- Differential mode unaffected: Task 1 Step 7 + Task 2 Step 3. ✓
- Bench confirms huge improvement: Task 2 Step 5. ✓

**Placeholder scan:**
- Task 2 Step 6 has `[actual before/after numbers from inspection]` — implementer fills from measurement.
- Line numbers in Task 1 noted as "pre-edit; shift as you edit" — acceptable guidance, not a placeholder.
- No "TBD" / "TODO".

**Type / name consistency:**
- `populateCache: boolean` — consistent across `calculateLayoutImpl`, `computeScrollSizes`, and all 4 call sites.
- The gate is `if (populateCache && node.getParent() !== null)` in `computeScrollSizes` and `if (populateCache)` around the root store — both consistent with the parameter.

No gaps. The scroll math (lines 259-268) is explicitly preserved unconditionally; only the cache block (272-281) and root store (234-236) are gated.
