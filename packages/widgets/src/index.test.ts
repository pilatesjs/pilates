/**
 * Public re-export contract for `@pilates/widgets`. A package consumer
 * imports widgets from the bare entry; removing a re-export is a
 * breaking change.
 */

import { describe, expect, it } from 'vitest';
import * as Widgets from './index.js';

describe('@pilates/widgets exports', () => {
  it('exports a VERSION string', () => {
    expect(typeof Widgets.VERSION).toBe('string');
    expect(Widgets.VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  it.each([
    'Spinner',
    'TextInput',
    'TextArea',
    'Select',
    'MultiSelect',
    'Tabs',
    'Table',
    'ProgressBar',
  ])('exports widget component %s', (name) => {
    expect((Widgets as Record<string, unknown>)[name]).toBeTypeOf('function');
  });

  it('exports SPINNER_FRAMES', () => {
    expect(Widgets.SPINNER_FRAMES).toBeDefined();
    expect(typeof Widgets.SPINNER_FRAMES).toBe('object');
  });
});
