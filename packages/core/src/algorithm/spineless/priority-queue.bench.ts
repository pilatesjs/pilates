/**
 * Microbenchmark for the OM-keyed priority queue.
 *
 * Targets (Phase 5 viability):
 * - `push`: < 2µs/op at N=10k (called once per dirty field per layout)
 * - `popMin`: < 2µs/op at N=10k (called once per recompute step)
 *
 * Each layout pass under Spineless may process up to ~5k field-recomputes
 * on a 1k-node TUI tree. Total PQ overhead must stay well under the
 * 50-100µs target for incremental layout to beat imperative.
 *
 * Run with: `tsx packages/core/src/algorithm/spineless/priority-queue.bench.ts`
 *
 * @internal
 */

import { BenderOrderMaintenance, type OMNode } from './order-maintenance.js';
import { OmPriorityQueue } from './priority-queue.js';

function median(xs: number[]): number {
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

function bench(label: string, sizes: number[], opsPerTrial: number, trials: number): void {
  console.log(`\n## ${label}`);
  for (const N of sizes) {
    const trialMsPush: number[] = [];
    const trialMsPop: number[] = [];

    for (let t = 0; t < trials; t++) {
      const om = new BenderOrderMaintenance();
      const nodes: OMNode[] = [om.init()];
      for (let i = 1; i < N; i++) nodes.push(om.insertAfter(nodes[i - 1]!));

      const pq = new OmPriorityQueue<number>(om);

      // Push phase
      let s = performance.now();
      for (let k = 0; k < opsPerTrial; k++) {
        // Use a deterministic but spread-out order so the heap actually re-orders.
        const i = (k * 2654435761) % N;
        pq.push(k, nodes[i]!);
      }
      let e = performance.now();
      trialMsPush.push(e - s);

      // Pop phase (extract everything)
      s = performance.now();
      while (!pq.isEmpty()) pq.popMin();
      e = performance.now();
      trialMsPop.push(e - s);
    }

    const usPush = (median(trialMsPush) * 1000) / opsPerTrial;
    const usPop = (median(trialMsPop) * 1000) / opsPerTrial;
    console.log(
      `  N=${N.toString().padStart(6)}  push=${usPush.toFixed(3).padStart(7)} µs  popMin=${usPop.toFixed(3).padStart(7)} µs`,
    );
  }
}

console.log('OmPriorityQueue microbench (Bender OM, single-threaded JS)');
console.log('Targets: push < 2µs, popMin < 2µs at N=10k');

bench('push + popMin', [100, 1000, 10000], 10_000, 5);
