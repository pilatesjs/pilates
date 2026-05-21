/**
 * Markdown reporter for one bench run. Produces a RESULTS.md-shaped
 * output: scenario-by-scenario tables with the new statistics
 * (median, P95, CI95 width) plus the prose sections this repo's
 * RESULTS.md has historically carried.
 *
 * @internal
 */

import { writeFileSync } from 'node:fs';
import type { BenchRunReport } from './reporter-json.js';
import type { ScenarioResult } from './runner.js';

function fmtNs(ns: number): string {
  if (ns < 1_000) return `${ns.toFixed(0)}ns`;
  if (ns < 1_000_000) return `${(ns / 1_000).toFixed(2)}µs`;
  if (ns < 1_000_000_000) return `${(ns / 1_000_000).toFixed(2)}ms`;
  return `${(ns / 1_000_000_000).toFixed(2)}s`;
}

function fmtHz(ns: number): string {
  if (ns <= 0) return '—';
  const hz = 1e9 / ns;
  if (hz >= 1_000_000) return `${(hz / 1_000_000).toFixed(2)}M ops/s`;
  if (hz >= 1_000) return `${(hz / 1_000).toFixed(1)}k ops/s`;
  return `${hz.toFixed(0)} ops/s`;
}

function fmtCi95(ci95: [number, number], median: number): string {
  // Report the CI95 width as ±max(median−lo, hi−median) for readability.
  const halfWidth = Math.max(median - ci95[0], ci95[1] - median);
  return `±${fmtNs(halfWidth)}`;
}

function renderScenario(s: ScenarioResult): string[] {
  const out: string[] = [];
  out.push(`## ${s.name}`);
  out.push('');
  out.push(`> ${s.notes}`);
  out.push('');
  out.push('| Engine | Median | CI95 | P95 | Throughput |');
  out.push('|---|---:|---:|---:|---:|');
  for (const e of s.engines) {
    out.push(
      `| ${e.name} | ${fmtNs(e.stats.median)} | ${fmtCi95(e.stats.ci95, e.stats.median)} | ${fmtNs(e.stats.p95)} | ${fmtHz(e.stats.median)} |`,
    );
  }
  out.push('');
  return out;
}

export function writeMarkdownReport(report: BenchRunReport, outPath: string): void {
  const lines: string[] = [];
  lines.push('# Pilates benchmark results');
  lines.push('');
  lines.push(
    `Generated: ${report.env.timestamp.slice(0, 10)} · Node ${report.env.node} · ${report.env.platformId}`,
  );
  lines.push('');
  lines.push(
    'Reproduce: `pnpm bench`. Numbers vary by machine — relative positions are the interesting signal. `Median` is reported alongside its bootstrap CI95 (median ± max half-width) over a ~5-second measurement window.',
  );
  lines.push('');
  lines.push('## Scenarios');
  lines.push('');
  lines.push('| Scenario | Tree shape |');
  lines.push('|---|---|');
  for (const s of report.scenarios) {
    lines.push(`| **${s.name}** | ${s.notes} |`);
  }
  lines.push('');
  for (const s of report.scenarios) {
    for (const line of renderScenario(s)) lines.push(line);
  }
  // Prose sections — preserved from the pre-overhaul RESULTS.md so
  // the document tells the same story about Pilates' workload coverage.
  lines.push(`## What's measured`);
  lines.push('');
  lines.push('Each iteration **runs one layout pass**. Persistent-tree');
  lines.push('scenarios (`hot*`) build the tree once before warmup; the');
  lines.push('measured iteration mutates and re-lays out. Throwaway-tree');
  lines.push('scenarios (`tiny`, `realistic`, `stress`, `big`, `huge`)');
  lines.push('build a fresh tree in the iteration and lay it out.');
  lines.push('');
  lines.push('Statistics: median, CI95 (bootstrap, 1000 resamples, ±2.5%');
  lines.push('to 97.5% percentiles of resampled medians), P95, throughput');
  lines.push('(1/median). Light 5% outlier trim feeds derived stats; raw');
  lines.push('samples are preserved in `bench/history/<sha>.json`.');
  writeFileSync(outPath, `${lines.join('\n')}\n`);
}
