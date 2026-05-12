/**
 * Microbenchmark for the Order Maintenance data structure.
 *
 * This is the **kill switch** for Phase 5 (Spineless Traversal): if OM
 * operations cost more than a small constant per op at 1k-10k node scale,
 * the algorithmic novelty of Spineless Traversal won't pay off in pure JS.
 *
 * Targets (Phase 5 viability criteria):
 * - `compare`: < 200ns per op at 10k nodes (it's the hot path; the
 *   Spineless priority queue calls it on every insert/extract).
 * - `insertAfter`: < 5µs amortized at 10k nodes (rarer, called when
 *   the dependency graph adds nodes — typically only during tree
 *   construction or large mutations).
 *
 * The naive impl is O(N) per insert, so it will exceed the insertAfter
 * target at scale. That's expected — the Bender et al. amortized O(1)
 * impl is what hits the target. We measure naive here as a baseline so
 * we can show the speedup when Bender lands.
 *
 * Run with: `tsx packages/core/src/algorithm/spineless/order-maintenance.bench.ts`
 *
 * @internal
 */

import { NaiveOrderMaintenance, type OMNode } from './order-maintenance.js';

function median(xs: number[]): number {
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

function bench(
  label: string,
  sizes: number[],
  opsPerTrial: number,
  trials: number,
  op: 'compare' | 'insertAfter',
): void {
  console.log(`\n## ${label} — ${op}`);
  for (const N of sizes) {
    const trialMs: number[] = [];
    for (let t = 0; t < trials; t++) {
      const om = new NaiveOrderMaintenance();
      const nodes: OMNode[] = [om.init()];
      // Pre-build N-1 more nodes
      for (let i = 1; i < N; i++) nodes.push(om.insertAfter(nodes[i - 1]!));

      const start = performance.now();
      if (op === 'compare') {
        // Fixed-pattern compares to avoid letting V8 optimize away
        let acc = 0;
        for (let k = 0; k < opsPerTrial; k++) {
          // Pick two pseudo-random nodes (deterministic, no Math.random cost)
          const i = (k * 2654435761) % N;
          const j = (k * 1597334677) % N;
          acc += om.compare(nodes[i]!, nodes[j]!);
        }
        if (acc === 12345.6789) console.log('!!!');
      } else {
        // Insert opsPerTrial new nodes; insert position cycles through
        // existing nodes so we hit middle-of-list (worst case for naive
        // renumber).
        for (let k = 0; k < opsPerTrial; k++) {
          const after = nodes[(k * 2654435761) % nodes.length]!;
          nodes.push(om.insertAfter(after));
        }
      }
      const end = performance.now();
      trialMs.push(end - start);
    }
    const ms = median(trialMs);
    const usPerOp = (ms * 1000) / opsPerTrial;
    const opsPerSec = (opsPerTrial / ms) * 1000;
    console.log(
      `  N=${N.toString().padStart(6)}  ${usPerOp.toFixed(3).padStart(8)} µs/op  ${(opsPerSec / 1000).toFixed(1).padStart(8)} kops/s`,
    );
  }
}

console.log('Naive Order Maintenance microbench (single-threaded JS, Node.js)');
console.log('Targets: compare < 0.2µs, insertAfter amortized < 5µs at N=10k');

bench('compare (hot path)', [100, 1000, 10000], 100_000, 5, 'compare');
bench('insertAfter (renumber cost)', [100, 1000, 10000], 1_000, 5, 'insertAfter');
