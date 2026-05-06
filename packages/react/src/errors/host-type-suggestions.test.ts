import { describe, expect, it } from 'vitest';
import { suggestHostTypeReplacement } from './host-type-suggestions.js';

describe('suggestHostTypeReplacement', () => {
  describe('HTML→Pilates mapping (highest priority)', () => {
    it('maps <div> to <Box> with HTML-specific message', () => {
      const r = suggestHostTypeReplacement('div');
      expect(r).toEqual({ kind: 'html', component: 'Box' });
    });

    it('maps layout-style HTML tags to <Box>', () => {
      for (const tag of ['div', 'section', 'article', 'main', 'header', 'footer', 'nav', 'aside']) {
        const r = suggestHostTypeReplacement(tag);
        expect(r).toEqual({ kind: 'html', component: 'Box' });
      }
    });

    it('maps text-style HTML tags to <Text>', () => {
      for (const tag of ['p', 'span', 'strong', 'em', 'b', 'i']) {
        const r = suggestHostTypeReplacement(tag);
        expect(r).toEqual({ kind: 'html', component: 'Text' });
      }
    });

    it('is case-insensitive on HTML lookup', () => {
      expect(suggestHostTypeReplacement('DIV')).toEqual({ kind: 'html', component: 'Box' });
      expect(suggestHostTypeReplacement('Div')).toEqual({ kind: 'html', component: 'Box' });
    });
  });

  describe('Levenshtein fallback for non-HTML', () => {
    it('suggests Box for lowercase "box"', () => {
      expect(suggestHostTypeReplacement('box')).toEqual({ kind: 'spelling', component: 'Box' });
    });

    it('suggests Box for typo "bx" (n<3 needs exact case-insensitive match → none)', () => {
      expect(suggestHostTypeReplacement('bx')).toBeUndefined();
    });

    it('suggests Box for typo "bxo" (n=3, dist 2 from Box)', () => {
      expect(suggestHostTypeReplacement('bxo')).toEqual({ kind: 'spelling', component: 'Box' });
    });

    it('returns undefined for far-away input', () => {
      expect(suggestHostTypeReplacement('xyzzy')).toBeUndefined();
    });
  });

  describe('precedence', () => {
    it('HTML mapping wins over Levenshtein when both could match', () => {
      expect(suggestHostTypeReplacement('p')).toEqual({ kind: 'html', component: 'Text' });
    });
  });
});
