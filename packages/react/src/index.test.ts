import { describe, expect, it } from 'vitest';
import * as Pilates from './index.js';

describe('@pilates/react public surface — error infrastructure', () => {
  it('re-exports PilatesError and the codes', () => {
    expect(typeof Pilates.PilatesError).toBe('function');
    expect(typeof Pilates.PilatesErrorCode).toBe('object');
    expect(Pilates.PilatesErrorCode.HookOutsideRender).toBe('PILATES_HOOK_OUTSIDE_RENDER');
  });

  it('re-exports isPilatesError + formatPilatesError', () => {
    expect(typeof Pilates.isPilatesError).toBe('function');
    expect(typeof Pilates.formatPilatesError).toBe('function');
  });

  it('re-exports the suggestion utility', () => {
    expect(typeof Pilates.suggestHostTypeReplacement).toBe('function');
    expect(typeof Pilates.didYouMean).toBe('function');
  });
});

describe('@pilates/react public surface — scrolling', () => {
  it('re-exports ScrollView and useScrollIntoFocus', () => {
    expect(typeof Pilates.ScrollView).toBe('object'); // forwardRef result
    expect(typeof Pilates.useScrollIntoFocus).toBe('function');
  });
});
