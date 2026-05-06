import { describe, expect, it } from 'vitest';
import { didYouMean } from './did-you-mean.js';

describe('didYouMean — TypeScript-style suggestion heuristic', () => {
  describe('short input (n < 3)', () => {
    it('returns case-insensitive exact match', () => {
      expect(didYouMean('Bx', ['Box', 'Text'])).toBeUndefined(); // n=2, no exact
      expect(didYouMean('Bo', ['Bo', 'Box'])).toBe('Bo');
      expect(didYouMean('bo', ['Bo'])).toBe('Bo');
    });

    it('returns undefined when no exact match for n<3', () => {
      expect(didYouMean('Bx', ['Box'])).toBeUndefined();
    });
  });

  describe('long input (n >= 3)', () => {
    it('suggests within threshold', () => {
      // n=3, maxDist = floor(0.4*3)+1 = 2
      expect(didYouMean('Bxo', ['Box', 'Text'])).toBe('Box');
    });

    it('returns undefined beyond threshold', () => {
      // n=3, maxDist=2; "abc" vs "Box" has distance 3
      expect(didYouMean('abc', ['Box'])).toBeUndefined();
    });

    it('rejects candidates whose length differs too much', () => {
      // n=3, maxLenDiff = min(2, floor(0.34*3)) = min(2, 1) = 1
      // "Bxo" (3) vs "BoxAndCo" (8) — len diff 5 > 1, rejected
      expect(didYouMean('Bxo', ['BoxAndCoExtra'])).toBeUndefined();
    });

    it('is case-insensitive', () => {
      expect(didYouMean('BOX', ['Box'])).toBe('Box');
      expect(didYouMean('box', ['Box'])).toBe('Box');
    });

    it('picks the closest of multiple candidates', () => {
      // 'Boxx' is dist 1 from 'Box', dist 4 from 'Static'; should pick Box
      expect(didYouMean('Boxx', ['Static', 'Box'])).toBe('Box');
    });
  });

  describe('edge cases', () => {
    it('returns undefined for empty candidate set', () => {
      expect(didYouMean('Box', [])).toBeUndefined();
    });

    it('returns undefined for empty input on n<3 path', () => {
      expect(didYouMean('', ['Box'])).toBeUndefined();
    });
  });
});
