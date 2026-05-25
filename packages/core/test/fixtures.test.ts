// packages/core/test/fixtures.test.ts
/**
 * Phase 3.1 declarative-fixture runner. See
 * docs/superpowers/specs/2026-05-25-phase31-yoga-fixture-corpus-design.md.
 *
 * Each fixture under packages/core/test/fixtures/ runs as one `it`,
 * asserting both Pilates and Yoga match the hand-authored expected boxes.
 * Engine ↔ engine disagreement is exposed by either of the two engine-vs-
 * expected assertions failing; the spec's policy is to defer (not commit)
 * such fixtures and file an issue.
 */
import { describe, expect, it } from 'vitest';
import {
  buildPilates,
  buildYoga,
  collectBoxes,
  formatBoxDiff,
  inspectLayout,
  isDivergent,
  loadFixtures,
  pilatesBox,
  yogaBox,
} from './fixture-loader.js';

const FIXTURES = loadFixtures();

describe('declarative fixtures', () => {
  if (FIXTURES.length === 0) {
    it.skip('no fixtures discovered (will be populated in later tasks)', () => {
      /* intentionally empty */
    });
    return;
  }

  for (const fixture of FIXTURES) {
    const divergentLabel = isDivergent(fixture) ? ' [divergent]' : '';
    const display = `[${fixture.tags.join(',')}] ${fixture.name}${divergentLabel}`;
    it(display, () => {
      const p = buildPilates(fixture.root);
      p.root.calculateLayout(fixture.available?.width, fixture.available?.height);
      const pBoxes = collectBoxes(p.byId, pilatesBox);

      const y = buildYoga(fixture.root);
      y.root.calculateLayout(fixture.available?.width, fixture.available?.height);
      const yBoxes = collectBoxes(y.byId, yogaBox);

      try {
        if (isDivergent(fixture)) {
          expect(pBoxes).toEqual(fixture.expectedPilates);
          expect(yBoxes).toEqual(fixture.expectedYoga);
        } else {
          expect(pBoxes).toEqual(fixture.expected);
          expect(yBoxes).toEqual(fixture.expected);
        }
      } catch (err) {
        const message = isDivergent(fixture)
          ? `\n${formatBoxDiff('Pilates vs expectedPilates', fixture.expectedPilates, pBoxes)}\n` +
            `${formatBoxDiff('Yoga vs expectedYoga', fixture.expectedYoga, yBoxes)}\n` +
            `── divergenceReason: ${fixture.divergenceReason} ──\n` +
            `── Pilates inspectLayout ──\n${inspectLayout(p.root)}\n` +
            `── source: ${fixture.sourcePath} ──`
          : `\n${formatBoxDiff('Pilates vs expected', fixture.expected, pBoxes)}\n` +
            `${formatBoxDiff('Yoga vs expected', fixture.expected, yBoxes)}\n` +
            `── Pilates inspectLayout ──\n${inspectLayout(p.root)}\n` +
            `── source: ${fixture.sourcePath} ──`;
        (err as Error).message = `${(err as Error).message}\n${message}`;
        throw err;
      } finally {
        y.root.freeRecursive();
      }
    });
  }
});
